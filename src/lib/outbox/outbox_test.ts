import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { MockLanguageModelV4 } from 'ai/test'
import Document from '#shared/models/Markdown/Document/mod.ts'
import { resolveTimeRef } from '#shared/nbfs/timeRef.ts'
import { assert, test } from '#test'
import { hash } from './files.ts'
import { readScanProgress } from './progress.ts'
import { dayRange } from './range.ts'
import { OutboxReview } from './review.ts'
import { scanOutbox, type Propose } from './scan.ts'
import { SavedMessages } from './sources.ts'
import { OutboxStore } from './store.ts'
import { createTriage } from './triage.ts'
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

test('Long-history scans retry failed passes, reject changing evidence and cache only the completed result', async () => {
  const f = await fixture()
  const body =
    '## 2025-03-15 08:00 - **Jane Doe**\n' +
    'Background context. '.repeat(12_000) +
    '\n\n## 2025-03-15 11:00 - **Jane Doe**\nDid the update arrive?'
  const updated = body + '\nPlease confirm the revised update.'
  let mode: 'failure' | 'change' | 'complete' = 'failure'
  let calls = 0
  let judgments = 0
  const model = new MockLanguageModelV4({
    doGenerate: async ({ prompt }) => {
      calls++
      const user = prompt.find((message) => message.role === 'user')!
      const input = JSON.parse(
        user.content
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join(''),
      )
      if (input.part === 2 && mode === 'failure') throw new Error('History reading was interrupted.')
      if (input.part === 1 && mode === 'change') await f.write(TODAY_REF, updated)
      if (!input.part) judgments++
      const { reasoning, ...reply } = proposal
      const result = input.part
        ? { notes: 'Jane supplied background context; the latest request must still be read.', evidence: [] }
        : { ...reply, explanation: reasoning, recommendation: '', replyOptions: [] }
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1, text: 1, reasoning: 0 },
        },
        warnings: [],
      }
    },
  })
  const propose = createTriage('I am Alex Example.', () => ({ model, maxRetries: 0 }))
  try {
    await f.write(TODAY_REF, body)
    await f.follow([TODAY_REF])
    const failed = await f.run(propose)
    const afterFailure = [(await f.store.list()).length, judgments]
    mode = 'change'
    const changed = await f.run(propose)
    const afterChange = (await f.store.list()).length
    mode = 'complete'
    const complete = await f.run(propose)
    const saved = (await f.store.list())[0]
    const completedCalls = calls
    const repeated = await f.run(propose)
    assert({
      given: 'a failed history pass, then a source edit during reading, then a stable retry',
      should: 'publish only the complete fresh result, retain its full evidence and reuse it on the next scan',
      actual: [
        [failed.failed, failed.pending],
        afterFailure,
        [changed.failed, changed.pending],
        afterChange,
        [complete.prepared, complete.failed, complete.pending],
        saved.draft,
        saved.conversation.sources[0].body === updated,
        repeated.unchanged,
        calls === completedCalls,
      ],
      expected: [[1, 1], [0, 0], [1, 1], 0, [1, 0, 0], proposal.draft, true, 1, true],
    })
  } finally {
    await f.clean()
  }
})

test('Outbox selects actual message times across dates, including a capture filed on a different day', async () => {
  const f = await fixture()
  try {
    const range = { start: '2025-03-14T23:30', end: '2025-03-15T09:15' }
    const values = [
      ['2025-03-14', '23:29', '2025-03-14'],
      ['2025-03-14', '23:30', '2025-03-14'],
      ['2025-03-15', '09:15', '2025-03-10'],
      ['2025-03-15', '09:16', '2025-03-15'],
    ]
    for (const [index, [date, time, filed]] of values.entries())
      await f.write(
        `${filed}/actions/messages/slack_Example-${index}.md`,
        `## ${date} ${time} - **Jane Doe**\nCould you review example ${index}?`,
        { follow: null, link: `https://atlas.slack.com/archives/C012ABCDEF/p1700000000000${index}00` },
      )
    const seen: string[] = []
    const report = await scanOutbox({
      store: f.store,
      sources: f.sources,
      today: TODAY,
      now: NOW,
      range,
      propose: async ({ conversation, range: supplied }) => {
        if (JSON.stringify(supplied) !== JSON.stringify(range)) throw new Error('Wrong range supplied to model')
        seen.push(conversation.sources[0].body)
        return proposal
      },
    })
    assert({
      given: 'a multi-day range and activity filed under another date',
      should: 'include exactly the two endpoint messages',
      actual: [
        report.total,
        report.prepared,
        seen.some((body) => body.includes('example 1')),
        seen.some((body) => body.includes('example 2')),
      ],
      expected: [2, 2, true, true],
    })
  } finally {
    await f.clean()
  }
})

test('An old selected range includes a later saved reply even without a follow record', async () => {
  const f = await fixture()
  try {
    await f.write(OLD_REF, '## 2025-03-14 09:00 - **Jane Doe**\nDid the update arrive?', { follow: null })
    const answer = '## 2025-03-15 09:00 - **Alex Example**\nYes, I have the update.'
    await f.write(TODAY_REF, answer, { follow: null })
    const result = await scanOutbox({
      store: f.store,
      sources: f.sources,
      today: TODAY,
      now: NOW,
      range: dayRange('2025-03-14'),
      propose: async ({ conversation, triggerSources }) => {
        if (conversation.sources.length !== 2 || triggerSources?.join() !== OLD_REF)
          throw new Error('Missing later reply or wrong trigger')
        return { ...proposal, action: 'ignore', responseEvidence: { ref: TODAY_REF, quote: answer } }
      },
    })
    assert({
      given: 'yesterday’s question and today’s saved answer in the same Slack thread',
      should: 'recognize the answer without reviving the old request',
      actual: [result.total, result.answered, (await f.store.list()).length],
      expected: [1, 1, 0],
    })
  } finally {
    await f.clean()
  }
})

test('Recorded sends persist across reruns while new requests reopen the same conversation', async () => {
  const f = await fixture()
  try {
    await f.write(TODAY_REF, '## 2025-03-15 09:00 - **Jane Doe**\nDid the update arrive?', { follow: null })
    await f.run()
    const item = (await f.store.list())[0]
    const review = new OutboxReview(
      f.store,
      f.sources,
      async () => ({ id: 'draft-1', url: LINK }),
      () => NOW,
    )
    const ready = await review.approve(item.id, item.revision, 'Got it, thanks.', false)
    const sent = await review.reportSent(ready.id, ready.revision, 'Sent the acknowledgment in Slack at noon.')
    let calls = 0
    const repeated = await f.run(async () => {
      calls++
      return proposal
    })
    await f.write(
      TODAY_REF,
      '## 2025-03-15 09:00 - **Jane Doe**\nDid the update arrive?\n\n## 2025-03-15 14:00 - **Jane Doe**\nCan you approve the revised scope?',
      { follow: null },
    )
    let received = ''
    const next = await f.run(async ({ priorResponse }) => {
      received = priorResponse?.responseHistory?.at(-1)?.reply ?? ''
      return { ...proposal, draft: 'The revised scope looks good.' }
    })
    const reopened = (await f.store.list())[0]
    assert({
      given: 'an explicitly reported send followed by a new request in the same thread',
      should: 'remember the sent reply, avoid duplicates, and prepare the new response',
      actual: [
        sent.status,
        repeated.answered,
        calls,
        next.prepared,
        received,
        reopened.id === item.id,
        reopened.status,
        reopened.native,
        reopened.delivery,
        reopened.responseHistory?.length,
      ],
      expected: ['dismissed', 1, 0, 1, 'Got it, thanks.', true, 'needs_review', null, undefined, 1],
    })
  } finally {
    await f.clean()
  }
})

test('Observed replies close an approved draft only with captured evidence and allow a subsequent ask', async () => {
  const f = await fixture()
  try {
    const ask = '## 2025-03-15 09:00 - **Jane Doe**\nDid the update arrive?'
    await f.write(TODAY_REF, ask, { follow: null })
    await f.run()
    const item = (await f.store.list())[0]
    const review = new OutboxReview(
      f.store,
      f.sources,
      async () => ({ id: 'draft-1', url: LINK }),
      () => NOW,
    )
    await review.approve(item.id, item.revision, 'Got it, thanks.', false)
    await f.write(TODAY_REF, `${ask}\n\n## 2025-03-15 09:15 - **Jane Doe**\nThanks for looking.`, { follow: null })
    const forged = await f.run(async () => ({
      ...proposal,
      action: 'ignore',
      responseEvidence: { ref: TODAY_REF, quote: 'A reply that is not in the capture.' },
    }))
    const kept = (await f.store.list())[0]
    const quote = '## 2025-03-15 09:20 - **Alex Example**\nGot it, thanks.'
    await f.write(TODAY_REF, `${ask}\n\n${quote}`, { follow: null })
    const answered = await f.run(async ({ priorResponse }) => {
      if (priorResponse?.delivery || priorResponse?.status !== 'ready') throw new Error('A draft was treated as sent')
      return { ...proposal, action: 'ignore', responseEvidence: { ref: TODAY_REF, quote } }
    })
    const closed = (await f.store.list())[0]
    await f.write(TODAY_REF, `${ask}\n\n${quote}\n\n## 2025-03-15 10:00 - **Jane Doe**\nOne more question?`, {
      follow: null,
    })
    const next = await f.run()
    assert({
      given: 'a claimed reply, then a real captured reply and another question',
      should: 'reject invented evidence, remember the observed answer, and reopen for new work',
      actual: [
        forged.failed,
        kept.status,
        answered.answered,
        closed.status,
        closed.responseHistory?.[0].kind,
        next.prepared,
        (await f.store.list())[0].native,
      ],
      expected: [1, 'ready', 1, 'dismissed', 'captured_reply', 1, null],
    })
  } finally {
    await f.clean()
  }
})

test('Changing the range reassesses a closed conversation with unchanged captured content', async () => {
  const f = await fixture()
  try {
    await f.write(
      TODAY_REF,
      '## 2025-03-15 09:00 - **Jane Doe**\nDid it arrive?\n\n## 2025-03-15 15:00 - **Jane Doe**\nCan you review the next update?',
      { follow: null },
    )
    const morning = { start: `${TODAY}T08:00`, end: `${TODAY}T10:00` }
    const run = (range: typeof morning, propose: Propose) =>
      scanOutbox({ store: f.store, sources: f.sources, today: TODAY, now: NOW, range, propose })
    await run(morning, async () => proposal)
    const item = (await f.store.list())[0]
    const review = new OutboxReview(
      f.store,
      f.sources,
      async () => ({ id: 'draft-1', url: LINK }),
      () => NOW,
    )
    await review.reportSent(item.id, item.revision, 'Replied to the morning question in Slack.')
    let calls = 0
    const result = await run({ start: `${TODAY}T14:00`, end: `${TODAY}T16:00` }, async () => {
      calls++
      return proposal
    })
    assert({
      given: 'a sent morning reply and a newly selected afternoon range',
      should: 'reconsider the afternoon request even when the source version has not changed',
      actual: [calls, result.prepared, (await f.store.list())[0].status],
      expected: [1, 1, 'needs_review'],
    })
  } finally {
    await f.clean()
  }
})

test('Missing timestamps and missing history cannot silently become a completed empty check', async () => {
  const f = await fixture()
  try {
    await f.write(TODAY_REF, 'Could you take a look?', {
      follow: null,
      previous: '2025-03-14/actions/messages/slack_Missing.md',
    })
    const range = { start: `${TODAY}T09:00`, end: `${TODAY}T10:00` }
    const report = await scanOutbox({
      store: f.store,
      sources: f.sources,
      today: TODAY,
      now: NOW,
      range,
      propose: async () => ({ ...proposal, action: 'ignore' }),
    })
    const record = (await f.store.list())[0]
    assert({
      given: 'an undated capture in the selected day and unreadable linked history',
      should: 'surface a decision and report incomplete coverage even if the model tries to ignore it',
      actual: [
        report.outcome,
        report.incomplete,
        report.pending,
        record.status,
        record.draft,
        Boolean(record.questions.length),
      ],
      expected: ['failed', 1, 1, 'needs_review', '', true],
    })
  } finally {
    await f.clean()
  }
})

test('Outbox only discovers today on every check while retaining linked history', async () => {
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
      should: 'include linked history without admitting older unrelated captures',
      actual: {
        prepared: [first.prepared, second.prepared, third.prepared],
        context: seen[0],
        total: (await f.store.list()).length,
      },
      expected: { prepared: [1, 0, 0], context: [OLD_REF, TODAY_REF], total: 1 },
    })
  } finally {
    await f.clean()
  }
})

test('Outbox excludes changed old content on subsequent checks too', async () => {
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
      should: 'never admit it as a candidate for today',
      actual: [first.prepared, second.prepared, calls],
      expected: [0, 0, 0],
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

test('Outbox completes more than five conversations, exposing progress and every skip reason', async () => {
  const f = await fixture()
  let release!: () => void
  let started!: () => void
  const hold = new Promise<void>((resolve) => {
    release = resolve
  })
  const entered = new Promise<void>((resolve) => {
    started = resolve
  })
  try {
    for (let i = 0; i < 12; i++) {
      await f.write(`${TODAY}/actions/messages/slack_Sample-${i}.md`, `Request ${i}`, {
        follow: null,
        link: `https://atlas.slack.com/archives/C012ABCDEF/p1700000000000${String(i).padStart(3, '0')}`,
      })
    }
    let active = 0
    let peak = 0
    let calls = 0
    const pending = scanOutbox({
      store: f.store,
      sources: f.sources,
      today: TODAY,
      now: NOW,
      model: 'test-model',
      propose: async ({ today, now }) => {
        if (today !== TODAY || now !== NOW) throw new Error('Missing date context')
        calls++
        active++
        peak = Math.max(peak, active)
        if (active === 4) started()
        await hold
        active--
        return { ...proposal, action: 'ignore', reasoning: 'Jane confirmed the request was resolved.' }
      },
    })
    await entered
    const progress = await readScanProgress(f.store)
    release()
    const result = await pending
    const done = await readScanProgress(f.store)
    const repeat = await f.run(async () => {
      throw new Error('Unchanged messages must reuse their result')
    })
    assert({
      given: 'a dozen independent requests in a single check',
      should: 'finish all, bound concurrency, persist progress, and explain cached results',
      actual: {
        running: [progress?.status, progress?.total, progress?.completed],
        complete: [result.total, result.completed, result.pending, calls, peak],
        audit: [
          done?.status,
          done?.checks.length,
          done?.checks.every(
            (check) => check.reason === 'Jane confirmed the request was resolved.' && check.model === 'test-model',
          ),
        ],
        repeat: [repeat.unchanged, repeat.failed, repeat.pending],
      },
      expected: {
        running: ['running', 12, 0],
        complete: [12, 12, 0, 12, 4],
        audit: ['complete', 12, true],
        repeat: [12, 0, 0],
      },
    })
  } finally {
    release?.()
    await f.clean()
  }
})

test('Outbox rechecks linked history even if today’s file metadata did not change', async () => {
  const f = await fixture()
  try {
    await f.write(OLD_REF, 'Earlier discussion.')
    await f.write(TODAY_REF, 'Which option should we choose?')
    await f.follow([OLD_REF, TODAY_REF])
    await f.run()
    await f.write(OLD_REF, 'Earlier discussion with a corrected constraint.')
    let calls = 0
    await f.run(async () => {
      calls++
      return proposal
    })
    assert({
      given: 'a correction to the context of today’s request',
      should: 'reassess the conversation',
      actual: calls,
      expected: 1,
    })
  } finally {
    await f.clean()
  }
})

test('Outbox reassesses legacy skips, drops the old backlog, and retires an untouched old-only item', async () => {
  const f = await fixture()
  try {
    await f.write(OLD_REF, 'A request from yesterday.', { follow: null })
    await f.run(undefined, OLD_REF.slice(0, 10))
    const old = (await f.store.list())[0]
    await f.write(TODAY_REF, 'A new decision for today.', {
      follow: null,
      link: 'https://atlas.slack.com/archives/C012ABCDEF/p1700000000000200',
    })
    const today = (await f.sources.conversation(TODAY_REF))!
    await writeFile(
      path.join(f.store.stateDir, 'sources.json'),
      JSON.stringify({
        version: 1,
        files: {},
        pending: [OLD_REF],
        handled: { [today.key]: today.version },
      }),
    )
    const result = await f.run()
    const items = await f.store.list()
    assert({
      given: 'a legacy checkpoint marked a current request handled and queued yesterday',
      should: 'review today again and remove only the untouched mistaken item',
      actual: [result.total, result.prepared, result.pending, items.find((item) => item.id === old.id)?.status],
      expected: [1, 1, 0, 'dismissed'],
    })
  } finally {
    await f.clean()
  }
})

test('Outbox preserves a dismissed version but resurfaces a new request in the same conversation', async () => {
  const f = await fixture()
  try {
    await f.write(TODAY_REF, 'First request.', { follow: null })
    await f.run()
    const item = (await f.store.list())[0]
    await f.store.put({ ...item, status: 'dismissed' }, item.revision)
    await f.run(async () => {
      throw new Error('Dismissal must remain quiet')
    })
    await f.write(TODAY_REF, 'A new unanswered question.', { follow: null })
    const next = await f.run()
    assert({
      given: 'new content after an owner dismissed a prior request',
      should: 'review the new request',
      actual: [next.prepared, (await f.store.list())[0].status],
      expected: [1, 'needs_review'],
    })
  } finally {
    await f.clean()
  }
})

test('Outbox upgrades cached summary-only items to drafted replies without replacing owner edits', async () => {
  const f = await fixture()
  try {
    await f.write(TODAY_REF, 'Which part should I clarify?', { follow: null })
    await f.run(async () => ({ ...proposal, action: 'decision', draft: '', questions: ['What should the reply say?'] }))
    const file = path.join(f.store.stateDir, 'sources.json')
    const checkpoint = JSON.parse(await readFile(file, 'utf8'))
    await writeFile(file, JSON.stringify({ ...checkpoint, policy: 'today-triage-v2' }))
    const filled = await f.run()
    const item = (await f.store.list())[0]
    await f.store.put({ ...item, draft: 'My own wording.', edited: true }, item.revision)
    const again = JSON.parse(await readFile(file, 'utf8'))
    await writeFile(file, JSON.stringify({ ...again, policy: 'today-triage-v2' }))
    await f.run(async () => {
      throw new Error('Owner wording must survive a policy upgrade')
    })
    assert({
      given: 'today’s unchanged conversations were checked with the summary-only policy',
      should: 'fill the untouched draft once and retain a subsequent owner edit',
      actual: [filled.prepared, item.draft, (await f.store.list())[0].draft],
      expected: [1, proposal.draft, 'My own wording.'],
    })
  } finally {
    await f.clean()
  }
})

test('Outbox composes from an owner decision without any native write and protects it on the next scan', async () => {
  const f = await fixture()
  try {
    await f.write(TODAY_REF, 'Choose the pilot scope.', { follow: null })
    await f.run(async () => ({
      ...proposal,
      action: 'decision',
      draft: '',
      questions: ['Which scope?'],
      replyOptions: [{ label: 'Small pilot', instruction: 'Choose the smaller pilot.' }],
    }))
    const item = (await f.store.list())[0]
    let writes = 0
    let received: string[] = []
    const review = new OutboxReview(
      f.store,
      f.sources,
      async () => {
        writes++
        return { id: 'native', url: LINK }
      },
      () => NOW,
      undefined,
      async ({ instruction, draft }) => {
        received = [instruction, draft]
        return { ...proposal, draft: 'Let’s start with the smaller pilot.', questions: [], replyOptions: [] }
      },
    )
    const result = await review.compose(item.id, item.revision, 'My rough note.', 'Choose the smaller pilot.')
    await f.write(TODAY_REF, 'Choose the pilot scope. An additional comment.', { follow: null })
    await f.run()
    const after = (await f.store.list())[0]
    assert({
      given: 'an owner picks a scope and Sky writes the reply',
      should: 'save a local review draft with resolved questions and retain it across new context',
      actual: [received, writes, result.status, result.draft, result.questions, after.draft, after.stale],
      expected: [
        ['Choose the smaller pilot.', 'My rough note.'],
        0,
        'needs_review',
        'Let’s start with the smaller pilot.',
        [],
        'Let’s start with the smaller pilot.',
        true,
      ],
    })
  } finally {
    await f.clean()
  }
})

test('Outbox preserves a newer human edit when reply composition finishes later', async () => {
  const f = await fixture()
  try {
    await f.write(TODAY_REF, 'Clarify the update.', { follow: null })
    await f.run()
    const item = (await f.store.list())[0]
    const review = new OutboxReview(
      f.store,
      f.sources,
      async () => {
        throw new Error('No native writes')
      },
      () => NOW,
      undefined,
      async () => {
        const current = (await f.store.get(item.id))!
        await f.store.put({ ...current, draft: 'My newer edit.', edited: true }, current.revision)
        return proposal
      },
    )
    const error = await errorOf(() => review.compose(item.id, item.revision, item.draft, 'Shorter'))
    assert({
      given: 'another editor saves while Sky writes',
      should: 'reject the stale result and preserve the newer text',
      actual: [Boolean(error), (await f.store.list())[0].draft],
      expected: [true, 'My newer edit.'],
    })
  } finally {
    await f.clean()
  }
})

test('Outbox rejects a reply based on messages that change during composition', async () => {
  const f = await fixture()
  try {
    await f.write(TODAY_REF, 'Clarify the update.', { follow: null })
    await f.run()
    const item = (await f.store.list())[0]
    const review = new OutboxReview(
      f.store,
      f.sources,
      async () => {
        throw new Error('No native writes')
      },
      () => NOW,
      undefined,
      async () => {
        await f.write(TODAY_REF, 'The request changed.', { follow: null })
        return { ...proposal, draft: 'An obsolete reply.' }
      },
    )
    const error = await errorOf(() => review.compose(item.id, item.revision, item.draft, 'Shorter'))
    assert({
      given: 'new messages arrive while Sky writes',
      should: 'reject the obsolete reply and keep the saved draft',
      actual: [Boolean(error), (await f.store.list())[0].draft],
      expected: [true, item.draft],
    })
  } finally {
    await f.clean()
  }
})

test('Outbox retains earlier owner answers when a reply needs one more detail', async () => {
  const f = await fixture()
  try {
    await f.write(TODAY_REF, 'Which day and time work?', { follow: null })
    await f.run(async () => ({ ...proposal, action: 'decision', draft: '', questions: ['Which day and time?'] }))
    const first = (await f.store.list())[0]
    let previous: string[] = []
    const review = new OutboxReview(
      f.store,
      f.sources,
      async () => {
        throw new Error('No native writes')
      },
      () => NOW,
      undefined,
      async ({ item, instruction }) => {
        previous = (item.replyDirections ?? []).map((direction) => direction.text)
        return instruction === 'Tuesday'
          ? { ...proposal, action: 'decision', draft: '', questions: ['What time on Tuesday?'] }
          : { ...proposal, draft: 'Tuesday at 10 works for me.', questions: [] }
      },
    )
    const question = await review.compose(first.id, first.revision, '', 'Tuesday')
    const answer = await review.compose(question.id, question.revision, '', '10 works')
    assert({
      given: 'an owner answers the day and then a follow-up about time',
      should: 'retain the first answer while completing the reply',
      actual: [previous, answer.draft, answer.replyDirections?.map((direction) => direction.text)],
      expected: [['Tuesday'], 'Tuesday at 10 works for me.', ['Tuesday', '10 works']],
    })
  } finally {
    await f.clean()
  }
})

test('Outbox reconsiders cached judgments when the model or effort profile changes', async () => {
  const f = await fixture()
  try {
    await f.write(TODAY_REF, 'A request to reconsider.', { follow: null })
    let calls = 0
    const run = (model: string, modelProfile: string, ignored: boolean) =>
      scanOutbox({
        store: f.store,
        sources: f.sources,
        today: TODAY,
        now: NOW,
        model,
        modelProfile,
        propose: async () => {
          calls++
          return { ...proposal, action: ignored ? 'ignore' : 'draft' }
        },
      })
    await run('model-a', 'profile-a', true)
    const unchanged = await run('model-a', 'profile-a', true)
    const replaced = await run('model-b', 'profile-b', false)
    const retuned = await run('model-b', 'profile-c', false)
    const item = (await f.store.list())[0]
    await f.store.put({ ...item, draft: 'My reviewed words.', edited: true }, item.revision)
    await run('model-c', 'profile-d', false)
    assert({
      given: 'a quiet result, a model switch, an effort change, and then an owner edit',
      should: 'reassess the earlier judgments while retaining the owner’s words',
      actual: [calls, unchanged.unchanged, replaced.prepared, retuned.prepared, (await f.store.list())[0].draft],
      expected: [3, 1, 1, 1, 'My reviewed words.'],
    })
  } finally {
    await f.clean()
  }
})

test('Outbox names new items by local time and title, suffixes a namesake, and keeps the id afterwards', async () => {
  const f = await fixture()
  try {
    await f.write(TODAY_REF, 'Did the update arrive?', { follow: null })
    await f.write(`${TODAY}/actions/messages/slack_Other.md`, 'Did the other update arrive?', {
      follow: null,
      link: 'https://atlas.slack.com/archives/C012ABCDEF/p1700000000000200',
    })
    const named = (localNow: string) =>
      scanOutbox({
        store: f.store,
        sources: f.sources,
        today: TODAY,
        now: NOW,
        localNow,
        propose: async () => proposal,
      })
    const first = await named(NOW)
    const before = (await f.store.list()).map((item) => item.id).sort()
    await f.write(TODAY_REF, 'Did the update arrive?\n\nAnd the invoice?', { follow: null })
    const second = await named(`${TODAY} 13:00`)
    const after = await f.store.list()
    assert({
      given: 'two conversations with the same proposed title in the same minute, then new content in one of them',
      should: 'allocate readable ids once, suffix the namesake, and reuse the id on later writes',
      actual: [
        first.prepared,
        before,
        (await readdir(path.join(f.store.dir, 'items'))).sort(),
        second.prepared,
        after.map((item) => item.id).sort(),
        after.every((item) => item.created === NOW),
      ],
      expected: [
        2,
        ['2025-03-15_1200_Confirm-the-update', '2025-03-15_1200_Confirm-the-update-2'],
        ['2025-03-15_1200_Confirm-the-update-2.md', '2025-03-15_1200_Confirm-the-update.md'],
        1,
        ['2025-03-15_1200_Confirm-the-update', '2025-03-15_1200_Confirm-the-update-2'],
        true,
      ],
    })
  } finally {
    await f.clean()
  }
})

test('Outbox keeps a hash-named item for its conversation instead of renaming it', async () => {
  const f = await fixture()
  try {
    await f.write(TODAY_REF, 'Did the update arrive?', { follow: null })
    const conversation = (await f.sources.conversation(TODAY_REF))!
    const legacy = hash(conversation.key).slice(0, 32)
    await f.store.put(
      {
        id: legacy,
        created: '2025-03-14 12:00',
        updated: '2025-03-14 12:00',
        status: 'needs_review',
        conversation: { ...conversation, version: 'old' },
        title: 'Confirm the update',
        situation: 'An earlier scan.',
        reasoning: 'A direct question needs a reply.',
        questions: [],
        originalDraft: 'An earlier draft.',
        draft: 'An earlier draft.',
        edited: false,
        stale: false,
        reviews: [],
        native: null,
        placementError: null,
      },
      null,
    )
    const report = await scanOutbox({
      store: f.store,
      sources: f.sources,
      today: TODAY,
      now: NOW,
      localNow: NOW,
      propose: async () => proposal,
    })
    const items = await f.store.list()
    assert({
      given: 'an item saved under the legacy hash id before the conversation changed',
      should: 'update that item in place without creating a readable-named twin',
      actual: [report.prepared, items.map((item) => item.id), items[0].draft, items[0].created],
      expected: [1, [legacy], proposal.draft, '2025-03-14 12:00'],
    })
  } finally {
    await f.clean()
  }
})
