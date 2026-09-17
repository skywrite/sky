import { BeeperError } from '#lib/beeper/mod.ts'
import { OutboxError, type OutboxRecord } from '#lib/outbox/types.ts'
import { assert, test } from '#test'
import {
  type BeeperDraftClient,
  type BeeperTarget,
  checkBeeperDraft,
  openBeeperChat,
  outboxErrorFromBeeper,
  placeBeeperDraft,
} from './beeper.ts'

const target: BeeperTarget = { medium: 'Beeper', account: 'whatsapp', chat: 'c1' }

function clientWith(draft: string | null) {
  const calls: string[] = []
  const chat = (text: string | null) => ({
    id: 'c1',
    accountID: 'whatsapp',
    network: 'WhatsApp',
    title: 'Maya Okafor',
    type: 'single' as const,
    draft: text === null ? null : { text },
  })
  const client: BeeperDraftClient = {
    chat: async () => chat(draft),
    setDraft: async (_id, text) => {
      calls.push(`draft:${text}`)
      return chat(text)
    },
    focus: async (params = {}) => {
      calls.push(`focus:${params.chatID}`)
      return { success: true }
    },
  }
  return { calls, client }
}

function item(native: boolean, final = 'Approved, go ahead.'): OutboxRecord {
  return {
    native: native ? { id: 'c1', url: '' } : null,
    reviews: [{ at: '2026-03-11 09:00', original: final, final, sourceVersion: 'v1' }],
  } as unknown as OutboxRecord
}

const outcome = (run: Promise<unknown>) =>
  run.then(
    () => 'ok',
    (error: unknown) => (error instanceof OutboxError ? error.message : 'other'),
  )

test('beeper drafts - only an empty composer, or Sky’s own untouched wording, is written over', async () => {
  assert({
    given:
      'composers that are empty, hold a stranger’s words, hold Sky’s wording as Beeper renders it, or hold an edit',
    should: 'allow the first and third and refuse the others in the person’s words',
    actual: await Promise.all([
      outcome(checkBeeperDraft(clientWith(null).client, target, item(false))),
      outcome(checkBeeperDraft(clientWith('<p>My own words</p>').client, target, item(false))),
      outcome(checkBeeperDraft(clientWith('<p>Approved, go  ahead.</p>').client, target, item(true))),
      outcome(checkBeeperDraft(clientWith('Approved, go ahead. Also lunch?').client, target, item(true))),
      outcome(checkBeeperDraft(clientWith('').client, target, item(true))),
    ]),
    expected: [
      'ok',
      'There is already a draft in this Beeper chat. Review it in Beeper first.',
      'ok',
      'This draft changed in Beeper. Review those changes in Beeper before replacing it.',
      'ok',
    ],
  })
})

test('beeper drafts - placing clears Sky’s earlier wording first, and opening focuses the chat', async () => {
  const fresh = clientWith(null)
  const replaced = clientWith('Approved, go ahead.')
  const placed = await placeBeeperDraft(fresh.client, target, 'Approved.', false)
  await placeBeeperDraft(replaced.client, target, 'Approved, with one change.', true)
  await openBeeperChat(fresh.client, target)
  assert({
    given: 'a first placement, a replacement, and an open',
    should: 'write once, clear then write, and focus the chat',
    actual: [placed, fresh.calls, replaced.calls],
    expected: [{ id: 'c1', url: '' }, ['draft:Approved.', 'focus:c1'], ['draft:', 'draft:Approved, with one change.']],
  })
})

test('beeper drafts - the app’s failures reach the page with a fitting status', () => {
  const map = (error: unknown) => {
    const mapped = outboxErrorFromBeeper(error)
    return mapped instanceof OutboxError ? [mapped.status, mapped.message] : 'passed through'
  }
  assert({
    given: 'a closed app, a refused token, a plain failure, and an unrelated error',
    should: 'read unavailable, conflict, bad request, and untouched',
    actual: [
      map(new BeeperError('Beeper Desktop is not running on this Mac.', 'unavailable')),
      map(new BeeperError('Reconnect Beeper in Settings.', 'unauthorized', 401)),
      map(new BeeperError('Chat not found', 'request', 404)),
      map(new Error('disk full')),
    ],
    expected: [
      [503, 'Beeper Desktop is not running on this Mac.'],
      [409, 'Reconnect Beeper in Settings.'],
      [400, 'Chat not found'],
      'passed through',
    ],
  })
})
