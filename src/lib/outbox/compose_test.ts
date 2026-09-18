import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import Document from '#shared/models/Markdown/Document/mod.ts'
import { resolveTimeRef } from '#shared/nbfs/timeRef.ts'
import { assert, test } from '#test'
import { OutboxReview } from './review.ts'
import { scanOutbox } from './scan.ts'
import { SavedMessages } from './sources.ts'
import { OutboxStore } from './store.ts'
import { OutboxError, type ComposeReply, type DraftProposal } from './types.ts'

const TODAY = '2025-03-15'
const NOW = `${TODAY} 12:00`
const proposal: DraftProposal = {
  action: 'draft',
  title: 'Confirm the update',
  situation: 'Jane asks whether the update arrived.',
  reasoning: 'A direct question needs a reply.',
  questions: [],
  draft: 'Thanks, Jane. I have the update.',
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-outbox-compose-test-'))
  const store = new OutboxStore(path.join(root, 'outbox'), path.join(root, 'state'))
  const sources = new SavedMessages(root, { Slack: [], Email: [] })
  const file = path.join(root, resolveTimeRef(`${TODAY}/actions/messages/slack_Atlas.md`))
  await mkdir(path.dirname(file), { recursive: true })
  const write = (body: string) =>
    writeFile(
      file,
      new Document(
        {
          from: 'Jane Doe',
          to: 'Alex Example',
          medium: 'Slack',
          link: 'https://atlas.slack.com/archives/C012ABCDEF/p1700000000000100',
        },
        body,
      ).toMarkdown(),
    )
  await write('Did the update arrive?')
  await scanOutbox({ store, sources, today: TODAY, now: NOW, propose: async () => proposal })
  const item = (await store.list())[0]
  const review = (compose: ComposeReply, context?: OutboxReview['currentContext']) =>
    new OutboxReview(
      store,
      sources,
      async () => {
        throw new Error('Revision must never place a native draft')
      },
      () => NOW,
      undefined,
      context,
      compose,
    )
  return { store, item, write, review, clean: () => rm(root, { recursive: true, force: true }) }
}

async function errorOf(run: () => Promise<unknown>): Promise<{ message: string; status: number | undefined }> {
  try {
    await run()
    return { message: '', status: undefined }
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : String(error),
      status: error instanceof OutboxError ? error.status : undefined,
    }
  }
}

test('Revision saves working text and direction before the model runs and retains both after failure', async () => {
  const f = await fixture()
  const started = Promise.withResolvers<void>()
  const reply = Promise.withResolvers<DraftProposal>()
  try {
    let calls = 0
    const review = f.review(async () => {
      calls++
      if (calls > 1) return { ...proposal, draft: 'I have the update, thanks.' }
      started.resolve()
      return reply.promise
    })
    const result = errorOf(() => review.compose(f.item.id, f.item.revision, 'My working reply.', '  Shorter.  '))
    await started.promise
    const pending = (await f.store.get(f.item.id))!
    assert({
      given: 'the model has started but has not returned',
      should: 'already have saved the working reply and trimmed direction without approving it',
      actual: [
        pending.draft,
        pending.replyDirections,
        pending.edited,
        pending.status,
        pending.originalDraft,
        pending.native,
        pending.reviews,
      ],
      expected: [
        'My working reply.',
        [{ at: NOW, text: 'Shorter.', sourceVersion: f.item.conversation.version }],
        true,
        'needs_review',
        f.item.originalDraft,
        null,
        [],
      ],
    })
    reply.reject(new Error('Model unavailable'))
    const error = await result
    const failed = (await f.store.get(f.item.id))!
    assert({
      given: 'the model fails after saving',
      should: 'retain the saved draft and instruction for recovery',
      actual: [error.message, failed.revision, failed.draft, failed.replyDirections],
      expected: ['Model unavailable', pending.revision, pending.draft, pending.replyDirections],
    })
    const stale = await errorOf(() => review.compose(f.item.id, f.item.revision, 'Old browser text.', 'Warmer.'))
    assert({
      given: 'a retry still carries the original browser revision',
      should: 'reject it before model work and leave the saved input intact',
      actual: [stale.status, calls, (await f.store.get(f.item.id))?.revision],
      expected: [409, 1, pending.revision],
    })
    const retried = await review.compose(failed.id, failed.revision, failed.draft, 'Shorter.')
    assert({
      given: 'the editor reloads the saved revision and retries',
      should: 'save the generated reply using the new revision',
      actual: [retried.draft, retried.status, retried.originalDraft, calls],
      expected: ['I have the update, thanks.', 'needs_review', f.item.originalDraft, 2],
    })
  } finally {
    reply.resolve(proposal)
    await f.clean()
  }
})

test('Revision saves the owner input even when source freshness prevents model work', async () => {
  const f = await fixture()
  try {
    await f.write('The request has changed. Please check the revised update.')
    let calls = 0
    const review = f.review(async () => {
      calls++
      return proposal
    })
    const error = await errorOf(() =>
      review.compose(f.item.id, f.item.revision, 'My latest wording.', 'Make it brief.'),
    )
    const saved = (await f.store.get(f.item.id))!
    assert({
      given: 'new source messages arrived before the owner asks for revision',
      should: 'save the working input and refreshed source but require review before writing',
      actual: [
        error.status,
        calls,
        saved.draft,
        saved.replyDirections?.at(-1)?.text,
        saved.replyDirections?.at(-1)?.sourceVersion,
        saved.conversation.version !== f.item.conversation.version,
        saved.stale,
      ],
      expected: [409, 0, 'My latest wording.', 'Make it brief.', f.item.conversation.version, true, true],
    })
    const retried = await review.compose(saved.id, saved.revision, saved.draft, 'Make it brief.', true)
    assert({
      given: 'the owner reviews the refreshed source and retries',
      should: 'allow revision with the saved working text',
      actual: [retried.draft, calls],
      expected: [proposal.draft, 1],
    })
  } finally {
    await f.clean()
  }
})

test('Revision saves owner input before checking changed workstream context', async () => {
  const f = await fixture()
  try {
    const item = await f.store.put(
      {
        ...f.item,
        workstreams: [
          { workstreamId: 'atlas', title: 'Atlas', context: 'Original scope', contextVersion: 'v1', decisionIds: [] },
        ],
      },
      f.item.revision,
    )
    let calls = 0
    const review = f.review(
      async () => {
        calls++
        return proposal
      },
      async (links) => links.map((link) => ({ ...link, context: 'Updated scope', contextVersion: 'v2' })),
    )
    const error = await errorOf(() => review.compose(item.id, item.revision, 'My scope reply.', 'Use fewer words.'))
    const saved = (await f.store.get(item.id))!
    assert({
      given: 'linked work changed before a revision request',
      should: 'retain the draft and direction while marking the context for review',
      actual: [
        error.status,
        calls,
        saved.draft,
        saved.replyDirections?.at(-1)?.text,
        saved.stale,
        saved.workstreams?.[0].contextVersion,
      ],
      expected: [409, 0, 'My scope reply.', 'Use fewer words.', true, 'v2'],
    })
  } finally {
    await f.clean()
  }
})

test('A newer human edit survives both model completion and source changes', async () => {
  const f = await fixture()
  try {
    const review = f.review(async () => {
      const saved = (await f.store.get(f.item.id))!
      await f.store.put({ ...saved, draft: 'The newer human edit.' }, saved.revision)
      await f.write('Another message arrived while the model was writing.')
      return { ...proposal, draft: 'An obsolete model reply.' }
    })
    const error = await errorOf(() => review.compose(f.item.id, f.item.revision, 'The submitted reply.', 'Shorter.'))
    const saved = (await f.store.get(f.item.id))!
    assert({
      given: 'another editor saves and source messages change while Sky is writing',
      should: 'reject all obsolete writes and preserve the newer human text and submitted direction',
      actual: [error.status, saved.draft, saved.replyDirections?.at(-1)?.text],
      expected: [409, 'The newer human edit.', 'Shorter.'],
    })
  } finally {
    await f.clean()
  }
})
