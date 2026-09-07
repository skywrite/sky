import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import Document from '#shared/models/Markdown/Document/mod.ts'
import { resolveTimeRef } from '#shared/nbfs/timeRef.ts'
import { assert, test } from '#test'
import { OutboxReview } from './review.ts'
import { scanOutbox, type Propose } from './scan.ts'
import { SavedMessages } from './sources.ts'
import { OutboxStore } from './store.ts'
import type { DraftProposal } from './types.ts'

const TODAY = '2025-03-15'
const NOW = `${TODAY} 12:00`
const TODAY_REF = `${TODAY}/actions/messages/slack_Atlas.md`
const OLD_REF = '2025-03-14/actions/messages/slack_Atlas.md'
const NEXT_REF = '2025-03-16/actions/messages/slack_Atlas.md'
const LINK = 'https://atlas.slack.com/archives/C012ABCDEF/p1700000000000100'
const proposal: DraftProposal = {
  action: 'draft',
  title: 'Confirm the update',
  situation: 'Jane asks whether the update arrived.',
  reasoning: 'A direct question needs a reply.',
  questions: [],
  draft: 'Thanks, Jane. I have the update.',
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-outbox-test-'))
  const follows = path.join(root, 'follows')
  await mkdir(follows)
  const store = new OutboxStore(path.join(root, 'outbox'), path.join(root, 'state'))
  const sources = new SavedMessages(root, { Slack: [follows], Email: [follows] })
  const write = async (ref: string, body: string, extra: Record<string, unknown> = {}) => {
    const file = path.join(root, resolveTimeRef(ref))
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(
      file,
      new Document(
        { from: 'Jane Doe', to: 'Alex Example', medium: 'Slack', link: LINK, follow: 'atlas-thread', ...extra },
        body,
      ).toMarkdown(),
    )
  }
  const follow = async (refs: string[]) => {
    await writeFile(
      path.join(follows, 'atlas-thread.yaml'),
      `source: Slack\nref:\n  link: ${LINK}\nmessages:\n${refs.map((ref) => `  - date: ${ref.slice(0, 10)}\n    path: ${ref}`).join('\n')}\n`,
    )
  }
  const run = (propose: Propose = async () => proposal, today = TODAY) =>
    scanOutbox({ store, sources, today, now: NOW, propose })
  return { root, store, sources, write, follow, run, clean: () => rm(root, { recursive: true, force: true }) }
}

async function errorOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
    return ''
  } catch (error) {
    return (error as Error).message
  }
}

test('Outbox baselines history, starts today, and later picks up an old-dated new capture', async () => {
  const f = await fixture()
  try {
    await f.write(OLD_REF, 'An older request.')
    await f.write(TODAY_REF, 'Did the update arrive?')
    await f.follow([OLD_REF, TODAY_REF])
    const seen: string[][] = []
    const propose: Propose = async ({ conversation }) => {
      seen.push(conversation.sources.map((source) => source.ref))
      return proposal
    }
    const first = await f.run(propose)
    const second = await f.run(propose)
    await f.write('2025-03-13/actions/messages/slack_New.md', 'A newly captured older request.', {
      follow: null,
      link: 'https://atlas.slack.com/archives/C012ABCDEF/p1700000000000200',
    })
    const third = await f.run(propose)
    assert({
      given: 'today with linked history, then an unchanged pass and a new old-dated capture',
      should: 'prepare once per new conversation and include older context',
      actual: {
        prepared: [first.prepared, second.prepared, third.prepared],
        context: seen[0],
        total: (await f.store.list()).length,
      },
      expected: { prepared: [1, 0, 1], context: [OLD_REF, TODAY_REF], total: 2 },
    })
  } finally {
    await f.clean()
  }
})

test('Outbox does not process old unlinked content on the first pass', async () => {
  const f = await fixture()
  try {
    await f.write(OLD_REF, 'Earlier request.', { follow: null })
    let calls = 0
    const first = await f.run(async () => {
      calls++
      return proposal
    })
    await f.write(OLD_REF, 'Earlier request with a new reply.', { follow: null })
    const second = await f.run(async () => {
      calls++
      return proposal
    })
    assert({
      given: 'an old saved conversation changes after the initial baseline',
      should: 'only read it for a proposal after it changes',
      actual: [first.prepared, second.prepared, calls],
      expected: [0, 1, 1],
    })
  } finally {
    await f.clean()
  }
})

test('Outbox ignores FYIs once and does not regenerate for metadata-only edits', async () => {
  const f = await fixture()
  try {
    await f.write(TODAY_REF, 'For your information only.', { follow: null })
    let calls = 0
    const propose: Propose = async () => {
      calls++
      return { ...proposal, action: 'ignore' }
    }
    await f.run(propose)
    await f.write(TODAY_REF, 'For your information only.', { follow: null, tags: 'operations' })
    await f.run(propose)
    assert({
      given: 'an ignored message is retagged',
      should: 'leave it quiet without another model call',
      actual: { calls, items: await f.store.list() },
      expected: { calls: 1, items: [] },
    })
  } finally {
    await f.clean()
  }
})

test('Outbox retains an edited draft across midnight and flags new conversation content', async () => {
  const f = await fixture()
  try {
    await f.write(TODAY_REF, 'Did the update arrive?')
    await f.follow([TODAY_REF])
    await f.run()
    const first = (await f.store.list())[0]
    await f.store.put({ ...first, draft: 'Got it, thanks.', edited: true }, first.revision)
    const nextDay = await f.run(undefined, '2025-03-16')
    await f.write(NEXT_REF, 'One more question about the update.')
    await f.follow([TODAY_REF, NEXT_REF])
    const changed = await f.run(undefined, '2025-03-16')
    const items = await f.store.list()
    assert({
      given: 'a reviewed draft and new messages on the following day',
      should: 'preserve the words, keep one decision, and require another look',
      actual: {
        nextDay: nextDay.prepared,
        stale: changed.stale,
        count: items.length,
        draft: items[0].draft,
        original: items[0].originalDraft,
        flagged: items[0].stale,
        sources: items[0].conversation.sources.length,
      },
      expected: {
        nextDay: 0,
        stale: 1,
        count: 1,
        draft: 'Got it, thanks.',
        original: proposal.draft,
        flagged: true,
        sources: 2,
      },
    })
  } finally {
    await f.clean()
  }
})

test('Outbox leaves failed model work queued and retries it', async () => {
  const f = await fixture()
  try {
    await f.write(TODAY_REF, 'Did the update arrive?', { follow: null })
    const failed = await f.run(async () => {
      throw new Error('Model unavailable')
    })
    const next = await f.run()
    assert({
      given: 'a model failure followed by a healthy pass',
      should: 'report failure without losing the request',
      actual: [failed.outcome, failed.pending, next.prepared, next.pending],
      expected: ['failed', 1, 1, 0],
    })
  } finally {
    await f.clean()
  }
})

test('Outbox rejects a proposal when new content arrives during the model call', async () => {
  const f = await fixture()
  try {
    await f.write(TODAY_REF, 'Did the update arrive?', { follow: null })
    const raced = await f.run(async () => {
      await f.write(TODAY_REF, 'The update changed.', { follow: null })
      return proposal
    })
    const next = await f.run()
    assert({
      given: 'a message changes while drafting',
      should: 'keep it queued and only publish the later proposal',
      actual: [raced.prepared, raced.pending, next.prepared],
      expected: [0, 1, 1],
    })
  } finally {
    await f.clean()
  }
})

test('Outbox never overwrites a human edit made while the model is thinking', async () => {
  const f = await fixture()
  try {
    await f.write(TODAY_REF, 'Did the update arrive?', { follow: null })
    await f.run()
    await f.write(TODAY_REF, 'An additional question.', { follow: null })
    await f.run(async () => {
      const current = (await f.store.list())[0]
      await f.store.put({ ...current, draft: 'My own reply.', edited: true }, current.revision)
      return { ...proposal, draft: 'A regenerated reply.' }
    })
    assert({
      given: 'a user saves while Sky regenerates',
      should: 'keep the user’s edit and the source pending',
      actual: (await f.store.list())[0].draft,
      expected: 'My own reply.',
    })
    const next = await f.run()
    assert({
      given: 'the retained source is processed again',
      should: 'flag the edited draft instead of overwriting it',
      actual: next.stale,
      expected: 1,
    })
  } finally {
    await f.clean()
  }
})

test('Outbox approval places the exact reviewed text once and retains the learning pair', async () => {
  const f = await fixture()
  try {
    await f.write(TODAY_REF, 'Did the update arrive?', { follow: null })
    await f.run()
    const item = (await f.store.list())[0]
    const placed: string[] = []
    const review = new OutboxReview(
      f.store,
      f.sources,
      async (record) => {
        placed.push(record.draft)
        return { id: 'draft-1', url: LINK }
      },
      () => NOW,
    )
    const approved = await review.approve(item.id, item.revision, 'Got it, thanks.', false)
    const repeated = await errorOf(() => review.approve(item.id, item.revision, 'Got it, thanks.', false))
    const examples: string[] = []
    await f.write('2025-03-15/actions/messages/slack_New.md', 'Another request.', {
      follow: null,
      link: 'https://atlas.slack.com/archives/C012ABCDEF/p1700000000000200',
    })
    await f.run(async ({ examples: pairs }) => {
      examples.push(...pairs.map((pair) => pair.final))
      return proposal
    })
    assert({
      given: 'approval is submitted twice, then another conversation is drafted',
      should: 'place once and teach the voice agent from the approved pair',
      actual: {
        placed,
        status: approved.status,
        original: approved.reviews[0].original,
        final: approved.reviews[0].final,
        repeated: Boolean(repeated),
        examples,
      },
      expected: {
        placed: ['Got it, thanks.'],
        status: 'ready',
        original: proposal.draft,
        final: 'Got it, thanks.',
        repeated: true,
        examples: ['Got it, thanks.'],
      },
    })
  } finally {
    await f.clean()
  }
})

test('Outbox refuses approval of a stale saved conversation before making any native call', async () => {
  const f = await fixture()
  try {
    await f.write(TODAY_REF, 'Did the update arrive?', { follow: null })
    await f.run()
    const item = (await f.store.list())[0]
    await f.write(TODAY_REF, 'Please wait, the update changed.', { follow: null })
    let calls = 0
    const review = new OutboxReview(
      f.store,
      f.sources,
      async () => {
        calls++
        return { id: 'draft-1', url: LINK }
      },
      () => NOW,
    )
    const error = await errorOf(() => review.approve(item.id, item.revision, item.draft, false))
    const refreshed = (await f.store.list())[0]
    const unacknowledged = await errorOf(() => review.approve(refreshed.id, refreshed.revision, refreshed.draft, false))
    assert({
      given: 'approval races with new captured content',
      should: 'require refreshed context and explicit acknowledgment',
      actual: [calls, Boolean(error), refreshed.stale, Boolean(unacknowledged)],
      expected: [0, true, true, true],
    })
  } finally {
    await f.clean()
  }
})

test('Outbox keeps an ambiguous native write out of Ready and refuses duplicate creation', async () => {
  const f = await fixture()
  try {
    await f.write(TODAY_REF, 'Did the update arrive?', { follow: null })
    await f.run()
    const item = (await f.store.list())[0]
    let calls = 0
    const review = new OutboxReview(
      f.store,
      f.sources,
      async () => {
        calls++
        throw new Error('Connection lost after request')
      },
      () => NOW,
    )
    const failed = await review.approve(item.id, item.revision, item.draft, false)
    const repeated = await errorOf(() => review.approve(failed.id, failed.revision, failed.draft, false))
    assert({
      given: 'the app may have accepted a draft before the connection failed',
      should: 'require checking the native app and never silently retry',
      actual: [failed.status, calls, Boolean(repeated)],
      expected: ['placement_unknown', 1, true],
    })
  } finally {
    await f.clean()
  }
})

test('Outbox persists Markdown decisions and refuses a damaged scanner checkpoint', async () => {
  const f = await fixture()
  try {
    await f.write(TODAY_REF, 'Did the update arrive?', { follow: null })
    await f.run()
    const item = (await f.store.list())[0]
    const file = await readFile(path.join(f.store.dir, 'items', `${item.id}.md`), 'utf8')
    const reopened = new OutboxStore(f.store.dir, f.store.stateDir)
    await writeFile(path.join(f.store.stateDir, 'sources.json'), '{broken')
    const error = await errorOf(() => f.run())
    assert({
      given: 'a restart followed by damaged automation state',
      should: 'keep the readable draft and refuse to reset the processed baseline',
      actual: [file.startsWith('---\n'), (await reopened.get(item.id))?.draft, Boolean(error)],
      expected: [true, proposal.draft, true],
    })
  } finally {
    await f.clean()
  }
})

test('Outbox resolves Gmail account and API thread identity from a saved follow', async () => {
  const f = await fixture()
  try {
    const ref = `${TODAY}/actions/messages/email_Atlas.md`
    await f.write(ref, 'Could you review this update?', { medium: 'Email', link: null })
    await writeFile(
      path.join(f.root, 'follows', 'atlas-thread.yaml'),
      `source: Email\nref:\n  account: alex@example.com\n  threadId: "65535"\nmessages:\n  - date: ${TODAY}\n    path: ${ref}\n`,
    )
    await f.run()
    const item = (await f.store.list())[0]
    assert({
      given: 'an email capture whose follow stores the decimal thread ID',
      should: 'retain the owning account and convert the native API target at the boundary',
      actual: item.conversation.target,
      expected: { medium: 'Email', account: 'alex@example.com', thread: 'ffff' },
    })
  } finally {
    await f.clean()
  }
})

test('Outbox uses the authoritative Slack root even when a capture links to a later reply', async () => {
  const f = await fixture()
  try {
    await f.write(TODAY_REF, 'A reply in the same thread.', {
      link: 'https://atlas.slack.com/archives/C012ABCDEF/p1700000000000999',
    })
    await f.follow([TODAY_REF])
    await f.run()
    const item = (await f.store.list())[0]
    assert({
      given: 'a saved reply permalink and a follow anchored at the root',
      should: 'place a reply in the original thread',
      actual: item.conversation.target,
      expected: { medium: 'Slack', link: LINK },
    })
  } finally {
    await f.clean()
  }
})

test('Outbox rejects overlapping scans without duplicating model work', async () => {
  const f = await fixture()
  try {
    await f.write(TODAY_REF, 'Did the update arrive?', { follow: null })
    let release!: () => void
    let started!: () => void
    const entered = new Promise<void>((resolve) => {
      started = resolve
    })
    const hold = new Promise<void>((resolve) => {
      release = resolve
    })
    let calls = 0
    const first = f.run(async () => {
      calls++
      started()
      await hold
      return proposal
    })
    await entered
    const overlap = await errorOf(() => f.run())
    release()
    await first
    assert({
      given: 'a manual scan overlaps a scheduler pass',
      should: 'retain a single producer',
      actual: [Boolean(overlap), calls, (await f.store.list()).length],
      expected: [true, 1, 1],
    })
  } finally {
    await f.clean()
  }
})

test('Outbox provider preflight can refuse an existing app draft without changing review state', async () => {
  const f = await fixture()
  try {
    await f.write(TODAY_REF, 'Did the update arrive?', { follow: null })
    await f.run()
    const item = (await f.store.list())[0]
    let writes = 0
    const review = new OutboxReview(
      f.store,
      f.sources,
      async () => {
        writes++
        return { id: 'draft-1', url: LINK }
      },
      () => NOW,
      async () => {
        throw new Error('The draft was edited in the native app.')
      },
    )
    const refused = await errorOf(() => review.approve(item.id, item.revision, item.draft, false))
    const saved = (await f.store.list())[0]
    assert({
      given: 'native preflight detects an existing edited draft',
      should: 'stop before the write boundary and keep the draft in review',
      actual: [writes, saved.status, saved.revision === item.revision, Boolean(refused)],
      expected: [0, 'needs_review', true, true],
    })
  } finally {
    await f.clean()
  }
})

test('Outbox does not invalidate a refreshed and approved draft when the scan checkpoint catches up', async () => {
  const f = await fixture()
  try {
    await f.write(TODAY_REF, 'Did the update arrive?', { follow: null })
    await f.run()
    const item = (await f.store.list())[0]
    const review = new OutboxReview(
      f.store,
      f.sources,
      async () => ({ id: 'draft-1', url: LINK }),
      () => NOW,
    )
    await f.write(TODAY_REF, 'The update has changed. Please use this version.', { follow: null })
    await errorOf(() => review.approve(item.id, item.revision, item.draft, false))
    const fresh = (await f.store.list())[0]
    await review.approve(fresh.id, fresh.revision, 'Thanks, I have the revised version.', true)
    await f.run()
    const ready = (await f.store.list())[0]
    assert({
      given: 'review refreshed the source before the scheduler caught up',
      should: 'keep the approval current',
      actual: [ready.status, ready.stale],
      expected: ['ready', false],
    })
  } finally {
    await f.clean()
  }
})

test('Outbox preferences persist as Markdown with metadata and detect edit conflicts', async () => {
  const f = await fixture()
  try {
    const initial = await f.store.preferences()
    await f.store.savePreferences('Keep replies short and warm.', initial.revision)
    const saved = await f.store.preferences()
    const conflict = await errorOf(() => f.store.savePreferences('An older edit.', initial.revision))
    const file = await readFile(path.join(f.store.dir, 'preferences.md'), 'utf8')
    assert({
      given: 'preferences are saved and then an older editor tries to save',
      should: 'persist the updated guidance without losing metadata or newer edits',
      actual: [saved.text, file.startsWith('---\n'), Boolean(conflict)],
      expected: ['Keep replies short and warm.', true, true],
    })
  } finally {
    await f.clean()
  }
})
