import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import * as config from '#config'
import { createOutboxRuntime } from '#lib/outbox/runtime.ts'
import type { OutboxItem } from '#lib/outbox/types.ts'
import { assert, test } from '#test'
import { createOutboxHost } from './createOutboxHost.ts'

const AT = '2025-03-15 12:00'

function record(id: string, updated: string, extra: Partial<OutboxItem> = {}): OutboxItem {
  return {
    id,
    created: AT,
    updated,
    status: 'needs_review',
    conversation: { key: `sample:${id}`, version: 'v1', medium: 'Slack', sources: [], target: null, limitations: [] },
    title: 'Confirm the update',
    situation: 'A direct request.',
    reasoning: 'A reply is needed.',
    questions: [],
    originalDraft: '',
    draft: '',
    edited: true,
    stale: false,
    reviews: [],
    native: null,
    placementError: null,
    ...extra,
  }
}

test('the Outbox report lists finished items newest first, capped at a hundred, beside the open list', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-outbox-host-test-'))
  const local = {
    ...config,
    DIR_BASE: path.join(root, 'notebook'),
    DIR_USER_DATA: path.join(root, 'data'),
    DIR_STATE: path.join(root, 'data', 'state'),
    DIR_AUTOMATIONS: path.join(root, 'notebook', 'automations'),
    DIR_INPUT: path.join(root, 'input'),
    DIR_OUTPUT: path.join(root, 'output'),
    FILE_ABOUT_ME: path.join(root, 'notebook', 'me', 'about.md'),
  }
  try {
    const { store } = createOutboxRuntime(local)
    const open = record('a'.repeat(32), '2025-03-15 12:00')
    const reopened = record('b'.repeat(32), '2025-03-15 11:00', {
      responseHistory: [{ at: AT, sourceVersion: 'v0', kind: 'captured_reply', evidence: 'Jane: thanks, received.' }],
    })
    const sent = record('2025-03-15_1000_Sent-reply', '2025-03-15 13:00', {
      status: 'dismissed',
      delivery: { at: AT, evidence: 'Sent in Slack.', kind: 'owner_report' },
    })
    const archived = record('2025-03-15_0900_Archived-request', '2025-03-15 09:00', { status: 'dismissed' })
    // Set aside by the scanner itself: never reviewed, so never something the person handled.
    const ignored = record('2025-03-15_0800_No-reply-needed', '2025-03-15 08:00', {
      status: 'dismissed',
      edited: false,
    })
    for (const item of [open, reopened, sent, archived, ignored]) await store.put(item, null)
    for (let n = 0; n < 100; n++) {
      const minute = `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`
      await store.put(record(`2025-03-14_0000_Filler-${n}`, `2025-03-14 ${minute}`, { status: 'dismissed' }), null)
    }
    const report = await createOutboxHost(local, { ENV_FILE_LOADED: '1' }).report()
    assert({
      given: 'open, reopened, sent, archived, scanner-ignored, and a hundred older archived items',
      should: 'keep the open list as before, list the newest hundred finished items, and leave out the ignored one',
      actual: [
        report.items.map((item) => item.id),
        report.done.length,
        report.done.slice(0, 3).map((item) => item.id),
        report.done.at(-1)?.id,
        report.done.every((item, index) => index === 0 || report.done[index - 1].updated >= item.updated),
        report.done.some((item) => item.id === ignored.id),
      ],
      expected: [
        ['a'.repeat(32), 'b'.repeat(32)],
        100,
        ['2025-03-15_1000_Sent-reply', 'b'.repeat(32), '2025-03-15_0900_Archived-request'],
        '2025-03-14_0000_Filler-3',
        true,
        false,
      ],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
