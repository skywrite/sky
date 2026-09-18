import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { hash } from '#lib/outbox/files.ts'
import { OutboxReview } from '#lib/outbox/review.ts'
import { scanOutbox } from '#lib/outbox/scan.ts'
import { SavedMessages } from '#lib/outbox/sources.ts'
import { OutboxStore } from '#lib/outbox/store.ts'
import Document from '#shared/models/Markdown/Document/mod.ts'
import { resolveTimeRef } from '#shared/nbfs/timeRef.ts'
import { assert, test } from '#test'
import { createWorkstreamOutbox } from './outbox.ts'
import { WorkstreamStore } from './store.ts'
import { ActivitySchema } from './types.ts'

const DAY = '2025-03-15'
const NOW = `${DAY} 12:00`
const REF = `${DAY}/actions/messages/slack_Atlas.md`
const LINK = 'https://atlas.slack.com/archives/C012ABCDEF/p1700000000000100'

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-workstream-outbox-'))
  const state = path.join(root, 'state', 'workstreams')
  const content = path.join(state, 'content')
  const workstreams = new WorkstreamStore(path.join(content, 'workstreams'), state, root, undefined, content)
  const store = new OutboxStore(path.join(root, 'outbox'), path.join(root, 'state', 'outbox'))
  const sources = new SavedMessages(root, { Slack: [], Email: [] })
  const workstream = await workstreams.create(
    {
      title: 'Atlas launch',
      outcome: 'Receive launch approval',
      activities: [ActivitySchema.parse({ id: 'request', title: 'Request approval' })],
    },
    NOW,
  )
  const bridge = createWorkstreamOutbox({ store, sources, workstreams, now: () => NOW })
  const write = async (body: string) => {
    const file = path.join(root, resolveTimeRef(REF))
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(
      file,
      new Document({ from: 'Jane Doe', to: 'Alex Example', medium: 'Slack', link: LINK }, body).toMarkdown(),
    )
  }
  const input = {
    workstreamId: workstream.id,
    activityId: 'request',
    revision: workstream.revision,
    title: 'Launch approval',
    draft: 'Jane, please review the launch brief.',
    medium: 'Slack' as const,
  }
  return { root, workstreams, store, sources, workstream, bridge, write, input }
}

async function errorOf(action: () => Promise<unknown>): Promise<string> {
  try {
    await action()
    return ''
  } catch (error) {
    return (error as Error).message
  }
}

test('Workstream outreach uses the existing Outbox and retries reuse one intent', async () => {
  const f = await fixture()
  try {
    const first = await f.bridge.prepare(f.input)
    const again = await f.bridge.prepare(f.input)
    let placed = 0
    const review = new OutboxReview(
      f.store,
      f.sources,
      async () => {
        placed++
        return { id: 'draft', url: 'https://example.com/draft' }
      },
      () => NOW,
      undefined,
      f.bridge.currentContext,
    )
    const failure = await errorOf(() => review.approve(first.item.id, first.item.revision, first.item.draft, false))
    assert({
      given: 'a proactive request without a verified conversation and a repeated invocation',
      should: 'keep one editable local draft and never invent a native destination',
      actual: [
        first.item.id === again.item.id,
        (await f.store.list()).length,
        again.workstream.activities[0].outboxId,
        placed,
        failure.includes('no verified'),
      ],
      expected: [true, 1, first.item.id, 0, true],
    })
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

test('Outbox source freshness follows state-owned workstream files and notebook context', async () => {
  const f = await fixture()
  try {
    const peer = await f.workstreams.create({ title: 'Pilot scope', notes: 'Original scope.' }, NOW)
    await writeFile(path.join(f.root, 'brief.md'), 'Original notebook brief.')
    const work = await f.workstreams.put(
      {
        ...f.workstream,
        sources: [
          { id: 'scope', path: peer.path, label: 'Scope', sensitive: false },
          { id: 'brief', path: 'brief.md', label: 'Brief', sensitive: false },
        ],
      },
      f.workstream.revision,
    )
    const prepared = await f.bridge.prepare({ ...f.input, revision: work.revision, sourceIds: ['scope', 'brief'] })
    const before = prepared.item.workstreams!
    await f.workstreams.put({ ...peer, notes: 'Revised scope.' }, peer.revision)
    const changedWork = await f.bridge.currentContext(before)
    await writeFile(path.join(f.root, 'brief.md'), 'Revised notebook brief.')
    const changedNote = await f.bridge.currentContext(changedWork)
    assert({
      given: 'an Outbox draft with context from both roots',
      should: 'notice edits in either source without rewriting the owner’s draft',
      actual: [
        before[0].contextVersion !== changedWork[0].contextVersion,
        changedWork[0].contextVersion !== changedNote[0].contextVersion,
        (await f.store.get(prepared.item.id))?.draft,
      ],
      expected: [true, true, prepared.item.draft],
    })
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

test('Linking work reuses a pending edited reply and new context never replaces the owner’s text', async () => {
  const f = await fixture()
  try {
    await f.write('Could you send the launch brief?')
    await scanOutbox({
      store: f.store,
      sources: f.sources,
      today: DAY,
      now: NOW,
      propose: async () => ({
        action: 'draft',
        title: 'Send brief',
        situation: 'Jane requested the brief.',
        reasoning: 'A reply is needed.',
        questions: [],
        draft: 'I will send the brief.',
      }),
    })
    const scanned = (await f.store.list())[0]
    const edited = await f.store.put(
      { ...scanned, draft: 'The revised brief is ready, Jane.', edited: true },
      scanned.revision,
    )
    const linked = await f.bridge.prepare({ ...f.input, sourceRef: REF })
    await f.write('Could you also include the launch checklist?')
    await scanOutbox({
      store: f.store,
      sources: f.sources,
      today: DAY,
      now: NOW,
      propose: async () => {
        throw new Error('An edited linked draft must not be regenerated')
      },
    })
    const current = (await f.store.get(linked.item.id))!
    assert({
      given: 'an edited pending reply receives a workstream link and a changed captured request',
      should: 'preserve one reply, its edits and work link while making changed context visible',
      actual: [
        linked.item.id === edited.id,
        (await f.store.list()).length,
        current.draft,
        current.stale,
        current.workstreams?.[0].workstreamId,
      ],
      expected: [true, 1, edited.draft, true, f.workstream.id],
    })
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

test('Approval checks linked decisions and workstream content before native placement', async () => {
  const f = await fixture()
  try {
    await f.write('Please confirm approval.')
    const prepared = await f.bridge.prepare({ ...f.input, sourceRef: REF })
    await f.workstreams.put(
      { ...prepared.workstream, outcome: 'Receive approval for a revised launch scope' },
      prepared.workstream.revision,
    )
    let placed = 0
    const review = new OutboxReview(
      f.store,
      f.sources,
      async () => {
        placed++
        return { id: 'draft', url: 'https://example.com/draft' }
      },
      () => NOW,
      undefined,
      f.bridge.currentContext,
    )
    const refusal = await errorOf(() =>
      review.approve(prepared.item.id, prepared.item.revision, prepared.item.draft, true),
    )
    const stale = (await f.store.get(prepared.item.id))!
    const ready = await review.approve(stale.id, stale.revision, stale.draft, true)
    assert({
      given: 'the desired outcome changed after drafting, followed by explicit review of refreshed context',
      should: 'block obsolete approval, preserve text, then record native readiness without claiming a send',
      actual: [
        refusal.includes('linked work changed'),
        stale.stale,
        stale.draft === prepared.item.draft,
        placed,
        ready.status,
        ready.delivery,
      ],
      expected: [true, true, true, 1, 'ready', undefined],
    })
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

test('Owner reports and a new saved response advance linked work with distinct evidence', async () => {
  const f = await fixture()
  try {
    await f.write('Please send the launch brief.')
    const prepared = await f.bridge.prepare({ ...f.input, sourceRef: REF })
    await f.bridge.reportSent(
      prepared.item.id,
      prepared.item.revision,
      'Sent the brief in the existing Slack thread this morning.',
    )
    await f.bridge.reportSent(
      prepared.item.id,
      prepared.item.revision,
      'Sent the brief in the existing Slack thread this morning.',
    )
    const waiting = (await f.workstreams.get(f.workstream.id))!
    const oldRefused = await errorOf(() =>
      f.bridge.reportResponse({
        workstreamId: waiting.id,
        activityId: 'request',
        revision: waiting.revision,
        sourceRef: REF,
        result: 'Approved',
        accepted: true,
      }),
    )
    const oldPathRefused = await errorOf(() =>
      f.bridge.reportResponse({
        workstreamId: waiting.id,
        activityId: 'request',
        revision: waiting.revision,
        sourceRef: resolveTimeRef(REF),
        result: 'Approved',
        accepted: true,
      }),
    )
    await f.write('The launch brief is approved.')
    const complete = await f.bridge.reportResponse({
      workstreamId: waiting.id,
      activityId: 'request',
      revision: waiting.revision,
      sourceRef: REF,
      result: 'Jane approved the launch brief.',
      accepted: true,
    })
    const retried = await f.bridge.reportResponse({
      workstreamId: waiting.id,
      activityId: 'request',
      revision: waiting.revision,
      sourceRef: REF,
      result: 'Jane approved the launch brief.',
      accepted: true,
    })
    assert({
      given: 'a sent report, repeated report, old source, and actual changed saved response',
      should: 'wait after sending and complete once only after an owner-assessed response',
      actual: [
        waiting.activities[0].state,
        waiting.history.filter((entry) => entry.kind === 'communication_sent_report').length,
        oldRefused.includes('new or changed'),
        oldPathRefused.includes('new or changed'),
        complete.activities[0].state,
        retried.revision === complete.revision,
        complete.state,
      ],
      expected: ['waiting', 1, true, true, 'done', true, 'active'],
    })
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

test('A revoked Sky grant prevents the Outbox queue effect', async () => {
  const f = await fixture()
  try {
    const grant = await f.workstreams.getGrant(f.workstream.id)
    const failure = await errorOf(() =>
      f.bridge.prepare({ ...f.input, actor: 'sky', expectedGrantRevision: grant.revision }),
    )
    assert({
      given: 'Sky attempts a proactive communication while standing responsibility is off',
      should: 'refuse before creating a review item',
      actual: [failure.includes('responsibility changed'), (await f.store.list()).length],
      expected: [true, 0],
    })
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

test('An original source revision is checked at the agent’s queue boundary', async () => {
  const f = await fixture()
  try {
    await writeFile(path.join(f.root, 'brief.md'), 'Original launch scope.')
    const work = await f.workstreams.put(
      { ...f.workstream, sources: [{ id: 'brief', path: 'brief.md', label: 'Launch brief', sensitive: false }] },
      f.workstream.revision,
    )
    const grant = await f.workstreams.getGrant(work.id)
    await writeFile(path.join(f.root, 'brief.md'), 'The scope changed while Sky was preparing.')
    const failure = await errorOf(() =>
      f.bridge.prepare({
        ...f.input,
        revision: work.revision,
        actor: 'sky',
        allowManual: true,
        expectedGrantRevision: grant.revision,
        sourceIds: ['brief'],
        expectedSourceVersions: { brief: hash('Original launch scope.') },
      }),
    )
    assert({
      given: 'a selected source changed after the model read it but before local queuing',
      should: 'discard the obsolete draft before creating an Outbox item',
      actual: [failure.includes('source changed'), (await f.store.list()).length],
      expected: [true, 0],
    })
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

test('An interrupted Outbox backlink is repaired without a second review item', async () => {
  const f = await fixture()
  try {
    const put = f.workstreams.put.bind(f.workstreams)
    let interrupt = true
    f.workstreams.put = async (work, revision) => {
      if (interrupt && work.activities.some((activity) => activity.outboxId)) {
        interrupt = false
        throw new Error('Interrupted before backlink')
      }
      return put(work, revision)
    }
    const failed = await errorOf(() => f.bridge.prepare(f.input))
    const recovered = await f.bridge.prepare(f.input)
    assert({
      given: 'the local draft was saved before an interruption prevented its backlink',
      should: 'recover the backlink and keep one intent',
      actual: [
        failed.includes('Interrupted'),
        (await f.store.list()).length,
        recovered.workstream.activities[0].outboxId === recovered.item.id,
      ],
      expected: [true, 1, true],
    })
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

test('Communication observation exposes fresh saved responses and truthful native state without copying drafts', async () => {
  const f = await fixture()
  try {
    await f.write('Please send the launch brief.')
    const prepared = await f.bridge.prepare({ ...f.input, sourceRef: REF })
    const first = (await f.bridge.list(f.workstream.id))[0]
    const same = (await f.bridge.list(f.workstream.id))[0]
    await f.write('Approved. '.repeat(2000))
    const fresh = (await f.bridge.list(f.workstream.id))[0]
    assert({
      given: 'an unchanged observation followed by new captured content while the draft remains in review',
      should: 'keep stable facts, expose the changed saved source within limits and never claim a send',
      actual: [
        first.version === same.version,
        fresh.version !== first.version,
        fresh.status,
        fresh.delivery,
        fresh.sources[0].changedSinceRequest,
        fresh.sources[0].body.length,
        fresh.sources[0].truncated,
        'draft' in fresh,
        (await f.store.get(prepared.item.id))!.conversation.version === prepared.item.conversation.version,
      ],
      expected: [true, true, 'needs_review', null, true, 8000, true, false, true],
    })
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})
