import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { MockLanguageModelV4 } from 'ai/test'
import type { VoiceWriter } from '#lib/writingVoice/types.ts'
import Document from '#shared/models/Markdown/Document/mod.ts'
import { resolveTimeRef } from '#shared/nbfs/timeRef.ts'
import { assert, test } from '#test'
import { AnalysisCache, MAX_ANALYSIS_INPUT_CHARS } from './analysisCache.ts'
import { hash } from './files.ts'
import { HISTORY_SOURCE_CHARS } from './history.ts'
import { readScanProgress } from './progress.ts'
import { dayRange, type ScanRange } from './range.ts'
import { replyDestination } from './replyDestination.ts'
import { createRequestAnalyzer, requestUnits } from './requestAnalysis.ts'
import { OutboxReview } from './review.ts'
import { scanOutbox } from './scan.ts'
import { SavedMessages } from './sources.ts'
import { OutboxStore } from './store.ts'
import { createTriage } from './triage.ts'
import type { Conversation, OutboxRecord } from './types.ts'

const TODAY = '2025-03-15'
const NOW = `${TODAY} 12:00`
const REF = `${TODAY}/actions/messages/slack_Atlas.md`
const OLD_REF = '2025-03-12/actions/messages/slack_Atlas.md'
const LATER_REF = '2025-03-16/actions/messages/slack_Atlas.md'
const LINK = 'https://atlas.slack.com/archives/C012ABCDEF/p1700000000000100'
const FOUR_HOURS = { start: `${TODAY}T08:00`, end: `${TODAY}T11:59` }
const WEEK = { start: '2025-03-10T00:00', end: '2025-03-16T23:59' }
const message = (at: string, text: string, owner = false) =>
  `## ${at} - **${owner ? 'Alex Example' : 'Jane Doe'}**\n${text}`
const ask = (id: string) => `[request:${id}] Could you confirm the ${id} scope?`
const answer = (id: string) => `[answer:${id}] The ${id} scope is confirmed.`

// The mock supplies known semantic judgments; assertions exercise persistence, scope, coverage and races.
function judgment(input: any): unknown {
  if (input.candidate)
    return {
      id: input.candidate.id,
      action: 'reply',
      basis: 'direct_request',
      explanation: 'Jane asks you to confirm the scope.',
      evidence: [input.candidate.origin],
      initiative: null,
    }
  if (input.plans)
    return {
      title: 'Confirm the Atlas scope',
      summary: 'Jane needs your confirmation of the Atlas pilot scope.',
      situation: 'Jane needs your confirmation of the Atlas scope.\n\nThe reply covers the open scope questions.',
      explanation: 'Jane asked for your confirmation.',
    }
  if (input.previousNotes !== undefined)
    return {
      complete: true,
      reviewedUnits: input.units.map((unit: any) => unit.id),
      notes: 'Alex Example is the owner; Jane Doe is asking about the Atlas scope.',
      requests: input.units.flatMap((unit: any) =>
        [...unit.text.matchAll(/\[request:([^\]]+)\][^\n]*/g)].map((match: RegExpMatchArray) => ({
          summary: match[1],
          origin: { unit: unit.id, quote: match[0] },
        })),
      ),
    }
  if (input.requests)
    return {
      requests: input.requests.map((request: any) => {
        const unit = input.units.find((unit: any) => unit.text.includes(answer(request.summary)))
        const proof = unit
          ? { unit: unit.id, quote: answer(request.summary) }
          : request.status === 'resolved'
            ? request.resolution
            : null
        return {
          id: request.id,
          status: proof ? 'resolved' : 'open',
          explanation: proof ? 'The owner answered this specific request.' : 'This request still needs an answer.',
          context: `Jane needs confirmation of ${request.summary}.`,
          evidence: proof ? [request.origin, proof] : [request.origin],
          resolution: proof,
        }
      }),
    }
  if (input.plannedAnswer)
    return {
      id: input.request.id,
      covered: input.reply.includes(input.plannedAnswer),
      explanation: 'Compared the answer.',
    }
  return {
    action: 'draft',
    coveredRequests: [input.request.id],
    destination: 'source_conversation',
    title: `Confirm ${input.request.summary}`,
    situation: `Jane needs confirmation of ${input.request.summary}.`,
    explanation: 'The scope can be confirmed from the saved context.',
    questions: [],
    recommendation: '',
    replyOptions: [],
    draft: answer(input.request.summary),
  }
}

function modelFixture() {
  const calls: any[] = []
  const control = {
    respond: async (input: any): Promise<any> => judgment(input),
    truncated: (_input: any): boolean => false,
  }
  const model = new MockLanguageModelV4({
    doGenerate: async ({ prompt }) => {
      const user = prompt.find((entry) => entry.role === 'user')!
      const input = JSON.parse(
        user.content
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join(''),
      )
      calls.push(input)
      const object = await control.respond(input)
      return {
        content: [
          { type: 'text', text: control.truncated(input) ? '{"complete":true,"requests":[' : JSON.stringify(object) },
        ],
        finishReason: { unified: control.truncated(input) ? 'length' : 'stop', raw: 'stop' },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1, text: 1, reasoning: 0 },
        },
        warnings: [],
      }
    },
  })
  return { calls, control, resolve: () => ({ model, maxRetries: 0 }) }
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-outbox-requests-test-'))
  const stateDir = path.join(root, 'state', 'outbox')
  const follows = path.join(root, 'follows')
  await mkdir(follows)
  const store = new OutboxStore(stateDir, stateDir)
  const sources = new SavedMessages(root, { Slack: [follows], Email: [] })
  const model = modelFixture()
  const write = async (ref: string, body: string) => {
    const file = path.join(root, resolveTimeRef(ref))
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(
      file,
      new Document(
        { from: 'Jane Doe', to: 'Alex Example', medium: 'Slack', link: LINK, follow: 'atlas-thread' },
        body,
      ).toMarkdown(),
    )
  }
  const follow = (refs: string[]) =>
    writeFile(
      path.join(follows, 'atlas-thread.yaml'),
      `source: Slack\nref:\n  link: ${LINK}\nmessages:\n${refs.map((ref) => `  - date: ${ref.slice(0, 10)}\n    path: ${ref}`).join('\n')}\n`,
    )
  await follow([REF])
  const run = (range: ScanRange = FOUR_HOURS, write?: VoiceWriter) =>
    scanOutbox({
      store,
      sources,
      today: TODAY,
      now: NOW,
      range,
      analyze: createRequestAnalyzer({ stateDir, ownerContext: 'I am Alex Example.', model: model.resolve }),
      propose: createTriage('I am Alex Example.', model.resolve, write),
    })
  const item = async () => (await store.list())[0]
  const review = new OutboxReview(
    store,
    sources,
    async () => {
      throw new Error('No native writes in request tests.')
    },
    () => NOW,
  )
  return {
    root,
    stateDir,
    store,
    sources,
    model,
    write,
    follow,
    run,
    item,
    review,
    clean: () => rm(root, { recursive: true, force: true }),
  }
}

const active = (item: OutboxRecord) =>
  item
    .requests!.filter((request) => item.requestIds!.includes(request.id))
    .map((request) => request.summary)
    .sort()

test('Reconciliation repairs a shortened citation once and reuses only the verified receipt', async () => {
  const f = await fixture()
  try {
    await f.write(REF, message(`${TODAY} 09:00`, `${ask('A')} See [the brief](https://example.com/brief).`))
    f.model.control.respond = async (input) => {
      const result: any = judgment(input)
      if (input.requests && !input.correction)
        result.requests[0].evidence[0] = {
          ...result.requests[0].evidence[0],
          quote: result.requests[0].evidence[0].quote.replace('[the brief](https://example.com/brief)', 'the brief'),
        }
      return result
    }
    const report = await f.run()
    const item = await f.item()
    const calls = f.model.calls.length
    const repeated = await f.run()
    const attempts = f.model.calls.filter((input) => input.requests)
    assert({
      given: 'a citation that drops the Markdown URL, followed by an exact correction',
      should: 'preserve strict evidence checking, make one repair attempt, and reuse the completed check',
      actual: [
        report.failed,
        attempts.length,
        Boolean(attempts[1].correction.error),
        item.requests![0].evidence[0].quote.includes('[the brief](https://example.com/brief)'),
        repeated.unchanged,
        f.model.calls.length === calls,
      ],
      expected: [0, 2, true, true, 1, true],
    })
  } finally {
    await f.clean()
  }
})

test('A promised separate message cannot be placed in the conversation where the promise was made', async () => {
  const f = await fixture()
  try {
    await f.write(REF, message(`${TODAY} 09:00`, ask('A')))
    f.model.control.respond = async (input) => {
      const result: any = judgment(input)
      if (input.request && !input.plannedAnswer) result.destination = 'separate_conversation'
      return result
    }
    await f.run()
    const item = await f.item()
    let writes = 0
    const review = new OutboxReview(
      f.store,
      f.sources,
      async () => {
        writes++
        return { id: 'native', url: 'https://example.com/draft' }
      },
      () => NOW,
    )
    let error = ''
    try {
      await review.approve(item.id, item.revision, item.draft, false)
    } catch (caught) {
      error = String(caught)
    }
    const request = item.requests![0]
    const legacyPromise: OutboxRecord = {
      ...item,
      requests: [
        {
          ...request,
          attention: { ...request.attention!, basis: 'owner_commitment' },
          response: { ...request.response!, destination: undefined },
        },
      ],
    }
    const sameThread: OutboxRecord = {
      ...item,
      requests: [{ ...request, response: { ...request.response!, destination: 'source_conversation' } }],
    }
    assert({
      given: 'a valid source thread but a reply addressed elsewhere, including an older unverified promise',
      should: 'keep the draft local even after source refresh, while allowing an established same-thread reply',
      actual: [
        Boolean(item.conversation.target),
        request.response?.destination,
        replyDestination(item),
        replyDestination(legacyPromise),
        replyDestination(sameThread),
        error.includes('intended conversation'),
        writes,
        (await f.item()).status,
      ],
      expected: [true, 'separate_conversation', null, null, item.conversation.target, true, 0, 'needs_review'],
    })
  } finally {
    await f.clean()
  }
})

test('A corrected ownership assessment removes a legacy review, including when linked history is incomplete', async () => {
  const outcomes: unknown[] = []
  for (const incomplete of [false, true]) {
    const f = await fixture()
    try {
      await f.write(REF, message(`${TODAY} 09:00`, ask('Testers')))
      if (incomplete) await rm(path.join(f.root, 'follows', 'atlas-thread.yaml'))
      await scanOutbox({
        store: f.store,
        sources: f.sources,
        today: TODAY,
        now: NOW,
        range: FOUR_HOURS,
        propose: async () => ({
          action: 'decision',
          title: 'Volunteer to test Atlas',
          situation: 'Jane wants volunteers.',
          reasoning: 'Ownership was uncertain.',
          questions: ['Do you want to volunteer?'],
          draft: '',
        }),
      })
      const legacy = await f.item()
      f.model.control.respond = async (input) =>
        input.candidate
          ? {
              id: input.candidate.id,
              action: 'none',
              basis: 'none',
              explanation: 'This broad call for testers leaves no response with you.',
              evidence: [],
              initiative: null,
            }
          : judgment(input)
      const report = await f.run()
      const result = await f.store.get(legacy.id)
      outcomes.push([
        incomplete,
        legacy.status,
        result?.status,
        result?.requestIds,
        report.prepared,
        report.incomplete,
        report.pending,
        f.model.calls.some((input) => input.request),
      ])
    } finally {
      await f.clean()
    }
  }
  assert({
    given: 'an existing unedited card created from uncertain ownership',
    should:
      'archive the card without planning an optional intervention, while keeping missing history visible in coverage',
    actual: outcomes,
    expected: [
      [false, 'needs_review', 'dismissed', [], 0, 0, 0, false],
      [true, 'needs_review', 'dismissed', [], 0, 1, 1, false],
    ],
  })
})

test('Four hours, a day and seven days give overlapping requests the same analysis and reply plans', async () => {
  const f = await fixture()
  try {
    await f.write(OLD_REF, message('2025-03-12 10:00', ask('Earlier')))
    await f.write(REF, [message(`${TODAY} 08:00`, ask('A')), message(`${TODAY} 09:00`, ask('B'))].join('\n\n'))
    await f.write(
      LATER_REF,
      [message('2025-03-16 08:00', answer('B'), true), message('2025-03-16 09:00', ask('Later'))].join('\n\n'),
    )
    await f.follow([OLD_REF, REF, LATER_REF])
    const narrow = await f.run()
    const first = await f.item()
    const calls = f.model.calls.length
    await f.run(dayRange(TODAY))
    const daily = await f.item()
    const afterDay = f.model.calls.length
    await f.run(WEEK)
    const weekly = await f.item()
    const firstA = first.requests!.find((request) => request.summary === 'A')!
    const overlap = (item: OutboxRecord) => item.requests!.find((request) => request.id === firstA.id)
    assert({
      given: 'several requests in the expanded review',
      should: 'describe their actual subject in a readable brief',
      actual: [weekly.title, weekly.situation],
      expected: [
        'Confirm the Atlas scope',
        'Jane needs your confirmation of the Atlas scope.\n\nThe reply covers the open scope questions.',
      ],
    })
    assert({
      given: 'linked earlier context, a later answer, and an unrelated later ask',
      should: 'resolve B from later evidence, keep A identical, and plan only newly selected requests when widening',
      actual: [
        narrow.failed,
        active(first),
        active(daily),
        active(weekly),
        first.requests!.find((request) => request.summary === 'B')!.status,
        overlap(daily),
        overlap(weekly),
        afterDay === calls,
        f.model.calls
          .slice(afterDay)
          .filter((input) => input.request)
          .map((input) => input.request.summary),
        f.model.calls.every((input) => !('searchRange' in input) && !('checkedAtUtc' in input)),
      ],
      expected: [
        0,
        ['A'],
        ['A'],
        ['A', 'Earlier', 'Later'],
        'resolved',
        firstA,
        firstA,
        true,
        ['Earlier', 'Later'],
        true,
      ],
    })
  } finally {
    await f.clean()
  }
})

test('Long conversations retain every ask and resume validated passes after a reader restart', async () => {
  const f = await fixture()
  try {
    const body = [
      message(`${TODAY} 08:00`, Array.from({ length: 9 }, (_, n) => ask(`A${n}`)).join('\n')),
      message(`${TODAY} 09:00`, 'Background context. '.repeat(14_000)),
      message(`${TODAY} 10:00`, ask('Tail')),
    ].join('\n\n')
    await f.write(REF, body)
    let extractions = 0
    let interrupt = true
    f.model.control.respond = async (input) => {
      if (input.previousNotes !== undefined && ++extractions === 3 && interrupt) throw new Error('Reader interrupted.')
      return judgment(input)
    }
    const failed = await f.run()
    const before = (await f.store.list()).length
    const completedInputs = f.model.calls.slice(0, -1).map((input) => JSON.stringify(input))
    const boundary = f.model.calls.length
    interrupt = false
    const retried = await f.run()
    const item = await f.item()
    const repeated = await f.run()
    assert({
      given: 'ten requests, multiple source chunks, reconciliation pages, and a failed intermediate extraction',
      should:
        'publish no partial item, resume earlier passes, cover the tail and every early ask, then reuse the completed check',
      actual: [
        failed.failed,
        failed.pending,
        before,
        retried.failed,
        active(item).length,
        item.requests!.every((request) => request.response?.draft === answer(request.summary)),
        f.model.calls.slice(boundary).every((input) => !completedInputs.includes(JSON.stringify(input))),
        f.model.calls.filter((input) => input.requests).every((input) => input.requests.length <= 4),
        f.model.calls.every(
          (input) =>
            JSON.stringify(input).length <= MAX_ANALYSIS_INPUT_CHARS &&
            (!input.units || JSON.stringify(input.units).length <= HISTORY_SOURCE_CHARS),
        ),
        repeated.unchanged,
      ],
      expected: [1, 1, 0, 0, 10, true, true, true, true, 1],
    })
  } finally {
    await f.clean()
  }
})

test('Failed reply planning keeps completed reading and already planned requests for retry', async () => {
  const f = await fixture()
  try {
    await f.write(REF, message(`${TODAY} 09:00`, `${ask('A')}\n${ask('B')}`))
    let interrupt = true
    f.model.control.respond = async (input) => {
      if (interrupt && input.request?.summary === 'B') throw new Error('Planner interrupted.')
      return judgment(input)
    }
    const failed = await f.run()
    const conversation = (await f.sources.conversation(REF))!
    const completed = JSON.parse(
      await readFile(path.join(new AnalysisCache(f.stateDir, conversation.key).dir, 'completed.json'), 'utf8'),
    )
    const before = (await f.store.list()).length
    const boundary = f.model.calls.length
    interrupt = false
    const retry = await f.run()
    assert({
      given: 'B fails after A has a validated reply plan',
      should: 'retain the full reading snapshot and resume at B without publishing A alone',
      actual: [
        failed.failed,
        before,
        completed.requests.length,
        retry.failed,
        active(await f.item()),
        f.model.calls
          .slice(boundary)
          .filter((input) => input.request)
          .map((input) => input.request.summary),
      ],
      expected: [1, 0, 2, 0, ['A', 'B'], ['B']],
    })
  } finally {
    await f.clean()
  }
})

test('Appending a capture reuses its unchanged prefix and edits to an answer reopen only its request', async () => {
  const f = await fixture()
  try {
    const prefix = [
      message(`${TODAY} 08:00`, ask('A')),
      message(`${TODAY} 08:01`, answer('A'), true),
      ...Array.from({ length: 64 }, (_, n) =>
        message(`${TODAY} 09:${String(n % 60).padStart(2, '0')}`, `Context ${n}.`),
      ),
    ].join('\n\n')
    await f.write(REF, prefix)
    await f.run()
    const initial = await f.item()
    const originId = initial.requests![0].id
    const firstInput = JSON.stringify(f.model.calls[0])
    const boundary = f.model.calls.length
    const appended = prefix + '\n\n' + message(`${TODAY} 11:00`, ask('B'))
    await f.write(REF, appended)
    await f.run()
    const afterAppend = await f.item()
    const reusedPrefix = !f.model.calls.slice(boundary).some((input) => JSON.stringify(input) === firstInput)
    await f.write(REF, appended.replace(answer('A'), 'I have not decided yet.'))
    await f.run()
    const afterEdit = await f.item()
    assert({
      given: 'an unchanged early answer, appended messages, then a corrected answer',
      should: 'reuse the early receipt on append, retain origin IDs, and invalidate the resolution after the edit',
      actual: [
        initial.status,
        active(afterAppend),
        reusedPrefix,
        afterEdit.requests!.find((request) => request.summary === 'A')!.id,
        active(afterEdit),
      ],
      expected: ['dismissed', ['B'], true, originId, ['A', 'B']],
    })
  } finally {
    await f.clean()
  }
})

test('An explicit archive applies to the reviewed asks and survives a restart and wider range', async () => {
  const f = await fixture()
  try {
    await f.write(OLD_REF, message('2025-03-12 09:00', ask('Earlier')))
    await f.write(REF, message(`${TODAY} 09:00`, ask('A')))
    await f.follow([OLD_REF, REF])
    await f.run()
    const item = await f.item()
    await f.review.dismiss(item.id, item.revision)
    await f.run(WEEK)
    const restored = await new OutboxStore(f.stateDir, f.stateDir).get(item.id)
    assert({
      given: 'A was reviewed and archived while Earlier was outside the selection',
      should: 'keep A archived and surface Earlier when widening, without transferring the archive',
      actual: [
        restored!.requests!.find((request) => request.summary === 'A')!.status,
        active(restored!),
        restored!.status,
      ],
      expected: ['dismissed', ['Earlier'], 'needs_review'],
    })
  } finally {
    await f.clean()
  }
})

test('Reporting a partial reply resolves only the answered ask and never covers a new ask', async () => {
  const f = await fixture()
  try {
    await f.write(REF, message(`${TODAY} 09:00`, `${ask('A')}\n${ask('B')}`))
    await f.run()
    const item = await f.item()
    const edited = await f.review.save(item.id, item.revision, answer('A'))
    const sent = await f.review.reportSent(item.id, edited.revision, 'Sent this wording in Slack.')
    const savedReports = sent.requests!.map((request) => [request.status, request.reports.length])
    await f.write(REF, item.conversation.sources[0].body + '\n\n' + message(`${TODAY} 10:00`, ask('C')))
    const report = await f.run()
    const after = await f.item()
    assert({
      given: 'a reply containing only the answer to A, followed by a new request C',
      should: 'check the report per request, preserve B, and give C no inherited sent evidence',
      actual: [
        savedReports,
        report.failed,
        after.requests!.find((request) => request.summary === 'A')!.status,
        after.requests!.find((request) => request.summary === 'A')!.resolution?.kind,
        active(after),
        after.requests!.find((request) => request.summary === 'C')!.reports.length,
        after.delivery,
      ],
      expected: [
        [
          ['uncertain', 1],
          ['uncertain', 1],
        ],
        0,
        'resolved',
        'owner_report',
        ['B', 'C'],
        0,
        undefined,
      ],
    })
  } finally {
    await f.clean()
  }
})

test('Polishing cannot silently drop a request answer from the combined reply', async () => {
  const f = await fixture()
  try {
    await f.write(REF, message(`${TODAY} 09:00`, `${ask('A')}\n${ask('B')}`))
    const report = await f.run(FOUR_HOURS, async () => ({ draft: answer('A'), rulesRevision: 'v1' }))
    const item = await f.item()
    assert({
      given: 'two complete plans but a shared writer that returns only the first answer',
      should: 'fall back to both grounded answers after the per-request coverage check',
      actual: [report.failed, item.draft, f.model.calls.filter((input) => input.plannedAnswer).length],
      expected: [0, `${answer('A')}\n\n${answer('B')}`, 2],
    })
  } finally {
    await f.clean()
  }
})

test('Incomplete extraction subdivides safely and omission or invented evidence prevents publication', async () => {
  const outcomes: unknown[] = []
  for (const mode of [
    'subdivide',
    'output-limit',
    'missing-unit',
    'missing-request',
    'invented-proof',
    'earlier-proof',
  ]) {
    const f = await fixture()
    try {
      await f.write(
        REF,
        [message(`${TODAY} 08:00`, answer('A'), true), message(`${TODAY} 09:00`, ask('A'))].join('\n\n'),
      )
      f.model.control.respond = async (input) => {
        const result: any = judgment(input)
        if (input.previousNotes !== undefined) {
          if (mode === 'subdivide' && input.units.length > 1)
            return { complete: false, notes: '', requests: [], reviewedUnits: [] }
          if (mode === 'missing-unit') result.reviewedUnits = []
        } else if (input.requests) {
          if (mode === 'missing-request') result.requests = []
          if (mode === 'invented-proof') result.requests[0].resolution.quote = 'This was never written.'
        }
        return result
      }
      f.model.control.truncated = (input) =>
        mode === 'output-limit' && input.previousNotes !== undefined && input.units.length > 1
      const report = await f.run()
      const item = await f.item()
      outcomes.push([mode, report.failed, Boolean(item), item?.requests?.[0].status])
    } finally {
      await f.clean()
    }
  }
  assert({
    given: 'a crowded extraction, missing coverage, fabricated evidence, or an answer predating the ask',
    should: 'subdivide the crowded read but refuse incomplete or ungrounded outcomes',
    actual: outcomes,
    expected: [
      ['subdivide', 0, true, 'open'],
      ['output-limit', 0, true, 'open'],
      ['missing-unit', 1, false, undefined],
      ['missing-request', 1, false, undefined],
      ['invented-proof', 1, false, undefined],
      ['earlier-proof', 1, false, undefined],
    ],
  })
})

test('A later withdrawal reopens a request resolved in an earlier reading pass', async () => {
  const f = await fixture()
  try {
    await f.write(
      REF,
      [
        message(`${TODAY} 08:00`, ask('A')),
        message(`${TODAY} 08:01`, answer('A'), true),
        message(`${TODAY} 09:00`, 'Background context. '.repeat(7000)),
        message(`${TODAY} 10:00`, 'The earlier confirmation was withdrawn; A needs a new decision.', true),
      ].join('\n\n'),
    )
    let sawResolved = false
    f.model.control.respond = async (input) => {
      const result: any = judgment(input)
      const withdrawal = input.units?.find((unit: any) => unit.text.includes('confirmation was withdrawn'))
      if (input.requests && withdrawal) {
        sawResolved = input.requests[0].status === 'resolved'
        result.requests[0] = {
          ...result.requests[0],
          status: 'open',
          resolution: null,
          evidence: [{ unit: withdrawal.id, quote: 'The earlier confirmation was withdrawn; A needs a new decision.' }],
          context: 'The prior confirmation was withdrawn.',
          explanation: 'A new decision is needed.',
        }
      }
      return result
    }
    const report = await f.run()
    const item = await f.item()
    assert({
      given: 'an answer followed by enough context to cross a reading boundary and then a withdrawal',
      should: 'reconcile the already resolved request with later evidence and reopen it',
      actual: [report.failed, sawResolved, active(item), item.requests![0].resolution],
      expected: [0, true, ['A'], null],
    })
  } finally {
    await f.clean()
  }
})

test('A remaining decision prevents a partial draft while preserving every request plan', async () => {
  const f = await fixture()
  try {
    await f.write(REF, message(`${TODAY} 09:00`, `${ask('A')}\n${ask('B')}`))
    f.model.control.respond = async (input) => {
      const result: any = judgment(input)
      return input.request?.summary === 'B'
        ? { ...result, action: 'decision', draft: '', questions: ['Which B scope do you approve?'] }
        : result
    }
    let writes = 0
    const report = await f.run(FOUR_HOURS, async ({ meaning }) => {
      writes++
      return { draft: meaning, rulesRevision: 'v1' }
    })
    const item = await f.item()
    assert({
      given: 'A can be answered but B needs a consequential owner choice',
      should: 'retain both plans and ask about B before composing a complete reply',
      actual: [
        report.failed,
        item.draft,
        item.questions,
        item.requests!.map((request) => request.response?.action),
        writes,
      ],
      expected: [0, '', ['Which B scope do you approve?'], ['draft', 'decision'], 0],
    })
  } finally {
    await f.clean()
  }
})

test('Model settings invalidate both a completed scan and its saved reading and planning passes', async () => {
  const f = await fixture()
  try {
    await f.write(REF, message(`${TODAY} 09:00`, ask('A')))
    await f.run()
    const boundary = f.model.calls.length
    const resolve = () => ({ ...f.model.resolve(), temperature: 0 })
    const report = await scanOutbox({
      store: f.store,
      sources: f.sources,
      today: TODAY,
      now: NOW,
      range: FOUR_HOURS,
      analyze: createRequestAnalyzer({ stateDir: f.stateDir, ownerContext: 'I am Alex Example.', model: resolve }),
      propose: createTriage('I am Alex Example.', resolve),
    })
    const replayed = f.model.calls.slice(boundary)
    assert({
      given: 'the conversation and selected range are unchanged but model settings changed',
      should: 'reassess with the new configuration rather than silently reusing the old result',
      actual: [
        report.failed,
        report.unchanged,
        replayed.length,
        replayed.some((input) => input.previousNotes !== undefined),
        replayed.some((input) => input.request),
      ],
      expected: [0, 0, 5, true, true],
    })
  } finally {
    await f.clean()
  }
})

test('Edited sources and concurrent owner decisions cannot be overwritten by a completed model pass', async () => {
  const outcomes: unknown[] = []
  for (const mode of ['source', 'owner']) {
    const f = await fixture()
    try {
      const body = message(`${TODAY} 09:00`, ask('A'))
      await f.write(REF, body)
      if (mode === 'owner') await f.run()
      await f.write(REF, body + '\n\n' + message(`${TODAY} 10:00`, ask('B')))
      let raced = false
      f.model.control.respond = async (input) => {
        if (!raced && input.request) {
          raced = true
          if (mode === 'source') await f.write(REF, body + '\nChanged during reading.')
          else {
            const item = await f.item()
            await f.review.dismiss(item.id, item.revision)
          }
        }
        return judgment(input)
      }
      const report = await f.run()
      const item = await f.item()
      outcomes.push([mode, report.failed, report.pending, item?.status, item?.requests?.[0].status])
    } finally {
      await f.clean()
    }
  }
  assert({
    given: 'the source changes or the owner archives while a reply is being planned',
    should: 'leave the scan pending and preserve the newer state',
    actual: outcomes,
    expected: [
      ['source', 1, 1, undefined, undefined],
      ['owner', 1, 1, 'dismissed', 'dismissed'],
    ],
  })
})

test('Corrupted reading receipts fail visibly without treating the conversation as newly unread', async () => {
  const f = await fixture()
  try {
    await f.write(REF, message(`${TODAY} 09:00`, ask('A')))
    await f.run()
    const item = await f.item()
    const directory = path.join(new AnalysisCache(f.stateDir, item.conversation.key).dir, 'passes')
    const file = (await readdir(directory))[0]
    await writeFile(path.join(directory, file), '{broken')
    const before = f.model.calls.length
    const report = await f.run(WEEK)
    const progress = await readScanProgress(f.store)
    assert({
      given: 'a damaged persisted pass and a wider range forcing accounting',
      should: 'retain the existing item and report failed work instead of silently resetting the checkpoint',
      actual: [report.failed, Boolean(progress?.checks[0].reason), (await f.item()).revision, f.model.calls.length],
      expected: [1, true, item.revision, before],
    })
  } finally {
    await f.clean()
  }
})

test('Duplicate captures share request units and legacy archives cover only their original snapshot', async () => {
  const f = await fixture()
  try {
    const body = message(`${TODAY} 09:00`, ask('A'))
    const conversation: Conversation = {
      key: 'legacy-thread',
      version: 'old',
      medium: 'Slack',
      target: null,
      limitations: [],
      sources: [
        { ref: REF, hash: hash(body), from: 'Jane Doe', to: 'Alex Example', body },
        { ref: LATER_REF, hash: hash(body), from: 'Jane Doe', to: 'Alex Example', body },
      ],
    }
    const prior: OutboxRecord = {
      id: 'a'.repeat(32),
      revision: 'old',
      created: NOW,
      updated: NOW,
      status: 'dismissed',
      conversation,
      title: 'Archived',
      situation: '',
      reasoning: '',
      questions: [],
      draft: '',
      originalDraft: '',
      edited: false,
      stale: false,
      reviews: [],
      native: null,
      placementError: null,
    }
    const analyzer = createRequestAnalyzer({
      stateDir: f.stateDir,
      ownerContext: 'I am Alex Example.',
      model: f.model.resolve,
    })
    const changed = {
      ...conversation,
      version: 'new',
      sources: [
        ...conversation.sources,
        { ...conversation.sources[0], ref: OLD_REF, body: message(`${TODAY} 10:00`, ask('B')) },
      ],
    }
    const result = await analyzer.analyze({ conversation: changed, prior, now: NOW })
    assert({
      given: 'two copies of A in an old archived item and a newly captured B',
      should: 'read A once, preserve its archive, and keep B open',
      actual: [
        requestUnits(conversation).length,
        result.requests.map((request) => [request.summary, request.status, request.dismissal?.kind]),
      ],
      expected: [
        1,
        [
          ['A', 'dismissed', 'legacy'],
          ['B', 'open', undefined],
        ],
      ],
    })
  } finally {
    await f.clean()
  }
})
