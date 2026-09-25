import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { createSecret } from '#lib/secrets/marshal.ts'
import { TestSecretsProvider } from '#lib/secrets/TestSecretsProvider.ts'
import { createTypeSafeClient } from '#shared/ai/typesafe/client.ts'
import type { AIUsageRecord } from '#shared/ai/usageLog.ts'
import { assert, test } from '#test'
import { AnalysisCache } from './analysisCache.ts'
import { createConversationScreen, SCREEN_SKIP_BELOW } from './conversationScreen.ts'
import { hash } from './files.ts'
import { HISTORY_SOURCE_CHARS } from './history.ts'
import type { OwnerInitiative } from './requestAttention.ts'
import type { ConversationScreenVerdict, RequestRecord } from './requestTypes.ts'
import type { Conversation, OutboxRecord } from './types.ts'

const PROFILE = '---\nname: Alex Example\n---\nI lead Example Company.'
const TODAY = '2025-03-15'
const REF = `${TODAY}/actions/messages/slack_Atlas.md`
const BODY = '## 2025-03-15 09:00 - **Jane Doe**\nThe service update is complete. FYI only.'
const conversation = (body = BODY): Conversation => ({
  key: 'atlas',
  version: hash(body),
  medium: 'Slack',
  sources: [{ ref: REF, hash: hash(body), from: 'Jane Doe', to: '#engineering', body }],
  target: null,
  limitations: [],
})
type Probabilities = ConversationScreenVerdict['probabilities']
const quiet: Probabilities = {
  direct_request: 0.05,
  active_exchange: 0.05,
  owner_commitment: 0.05,
  initiative_decision: 0.1,
  uncertain_context: 0.1,
}
function response(probabilities: Partial<Probabilities> = quiet) {
  return Response.json({
    model: 'jev-test',
    answers: Object.fromEntries(Object.entries(probabilities).map(([key, noul]) => [key, { type: 'noul', noul }])),
    usage: { input_tokens: 100, output_tokens: 0 },
  })
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-outbox-screen-test-'))
  const calls: any[] = []
  const usage: AIUsageRecord[] = []
  const control = { response: (_init?: RequestInit): Response | Promise<Response> => response() }
  const secrets = new TestSecretsProvider({ 'typesafe/main': createSecret('tsk-test-key') })
  const client = createTypeSafeClient({
    secrets,
    fetch: (async (_url, init) => {
      calls.push(JSON.parse(String(init?.body)))
      return control.response(init)
    }) as typeof fetch,
  })
  const screen = (options: { ownerContext?: string; today?: string; initiatives?: OwnerInitiative[] } = {}) =>
    createConversationScreen(client, {
      ownerContext: PROFILE,
      today: TODAY,
      sink: (record) => void usage.push(record),
      ...options,
    })
  return {
    root,
    calls,
    usage,
    control,
    secrets,
    screen,
    cache: new AnalysisCache(root, 'atlas'),
    clean: () => rm(root, { recursive: true, force: true }),
  }
}

function prior(saved = conversation()): OutboxRecord {
  return {
    id: 'a'.repeat(32),
    revision: 'v1',
    created: `${TODAY} 10:00`,
    updated: `${TODAY} 10:00`,
    status: 'dismissed',
    conversation: saved,
    title: 'No reply needed',
    situation: '',
    reasoning: '',
    questions: [],
    draft: '',
    originalDraft: '',
    edited: false,
    stale: false,
    reviews: [],
    requests: [],
    requestIds: [],
    native: null,
    placementError: null,
  }
}

test('Jev screens the complete linked conversation with the existing policy and reuses its validated result', async () => {
  const f = await fixture()
  try {
    const saved = conversation()
    saved.sources.unshift({
      ref: '2025-03-14/actions/messages/slack_Atlas.md',
      hash: 'earlier',
      from: 'Alex Example',
      to: '#engineering',
      body: '## 2025-03-14 10:00 - **Alex Example**\nIs the service update complete?',
    })
    const screen = f.screen()
    const input = { conversation: saved, prior: null, cache: f.cache }
    const verdict = await screen.assess(input)
    const reused = await f.screen().assess(input)
    const request = f.calls[0]
    assert({
      given: 'an earlier owner question and a later answer in separate captures',
      should: 'supply both in order with the policy, record usage, and reuse the same result across workers',
      actual: [
        verdict?.skipped,
        verdict?.model,
        reused,
        f.calls.length,
        f.usage.map(({ provider, model }) => [provider, model]),
        request.state.conversation.sources.map((source: any) => source.body),
        Object.values(request.questions).every((value: any) => value.instructions.policy.includes('Use `waiting`')),
        'searchRange' in request.state,
      ],
      expected: [
        true,
        'jev-test',
        verdict,
        1,
        [['typesafe', 'jev-test']],
        saved.sources.map(({ body }) => body),
        true,
        false,
      ],
    })
  } finally {
    await f.clean()
  }
})

test('Every ownership basis and ambiguous context can keep a conversation in full analysis', async () => {
  const f = await fixture()
  try {
    const results: unknown[] = []
    for (const key of Object.keys(quiet)) {
      for (const probability of [SCREEN_SKIP_BELOW, 0.5, 0.99]) {
        f.control.response = () => response({ ...quiet, [key]: probability })
        const verdict = await f.screen().assess({
          conversation: conversation(`${BODY}\n${key} ${probability}`),
          prior: null,
          cache: f.cache,
        })
        results.push(verdict?.skipped)
      }
    }
    assert({
      given: 'a possible direct ask, participation, promise, initiative decision, or unclear context',
      should: 'keep the normal analysis at the threshold, under uncertainty, and when a response is likely',
      actual: results,
      expected: Array(15).fill(false),
    })
  } finally {
    await f.clean()
  }
})

test('Changed messages, owner context, initiatives and local date invalidate a negative screen', async () => {
  const f = await fixture()
  try {
    const input = { conversation: conversation(), prior: null, cache: f.cache }
    const baseline = f.screen()
    await baseline.assess(input)
    const variants = [
      f.screen({ ownerContext: `${PROFILE}\nI approve the Atlas budget.` }),
      f.screen({ today: '2025-03-16' }),
      f.screen({
        initiatives: [{ ref: 'workstreams/Atlas', title: 'Atlas', context: 'Alex approves the launch.' }],
      }),
    ]
    for (const screen of variants) await screen.assess(input)
    await baseline.assess({ ...input, conversation: conversation(`${BODY}\nAlex, please approve the release.`) })
    assert({
      given: 'an unchanged capture followed by changes to each input that can create an obligation',
      should: 'ask again and invalidate the scanner fingerprint when owner context or the date changes',
      actual: [
        f.calls.length,
        new Set(await Promise.all([baseline, ...variants].map((screen) => screen.version()))).size,
      ],
      expected: [5, 4],
    })
  } finally {
    await f.clean()
  }
})

test('Existing requests and human review state always bypass the screen', async () => {
  const f = await fixture()
  try {
    const request: RequestRecord = {
      id: 'b'.repeat(32),
      summary: 'Approve the release',
      origin: { kind: 'message', ref: REF, message: 'ask', at: `${TODAY} 09:00`, quote: 'Please approve.' },
      status: 'open',
      explanation: 'Approval is due.',
      context: '',
      evidence: [],
      resolution: null,
      present: true,
      reports: [],
    }
    const states: Partial<OutboxRecord>[] = [
      ...(['open', 'resolved', 'uncertain', 'dismissed'] as const).map((status) => ({
        requests: [{ ...request, status }],
      })),
      { requests: undefined },
      { status: 'needs_review' },
      { edited: true },
      { draft: 'My reply.' },
      { native: { id: 'draft-1', url: 'https://example.com/draft' } },
      { reviews: [{ at: TODAY, original: 'Draft.', final: 'Reply.', sourceVersion: 'v1' }] },
      { delivery: { at: TODAY, kind: 'owner_report', evidence: 'Sent in chat.' } },
      { origin: 'workstream' },
      { origin: 'followup' },
    ]
    const outcomes: (ConversationScreenVerdict | null)[] = []
    for (const fields of states)
      outcomes.push(
        await f.screen().assess({ conversation: conversation(), prior: { ...prior(), ...fields }, cache: f.cache }),
      )
    assert({
      given: 'previous requests, legacy reviews, drafts, approvals, sent reports and generated follow-ups',
      should: 'leave every one to the full reader without calling Jev',
      actual: [outcomes.every((value) => value === null), f.calls.length],
      expected: [true, 0],
    })
    const empty = await f.screen().assess({ conversation: conversation(), prior: prior(), cache: f.cache })
    assert({
      given: 'only a previous empty, untouched result',
      should: 'allow a new screen',
      actual: empty?.skipped,
      expected: true,
    })
  } finally {
    await f.clean()
  }
})

test('Incomplete or oversized context and an unknown owner keep full analysis', async () => {
  const f = await fixture()
  try {
    const outcomes: (ConversationScreenVerdict | null)[] = []
    for (const saved of [
      { ...conversation(), incomplete: true },
      { ...conversation(), limitations: ['Missing earlier messages.'] },
      { ...conversation(), sources: [] },
      conversation('x'.repeat(HISTORY_SOURCE_CHARS + 1)),
    ])
      outcomes.push(await f.screen().assess({ conversation: saved, prior: null, cache: f.cache }))
    outcomes.push(
      await f.screen({ ownerContext: '' }).assess({ conversation: conversation(), prior: null, cache: f.cache }),
    )
    assert({
      given: 'a missing part of the thread, too much text to screen intact, or no identified owner',
      should: 'never screen a truncated or ambiguous view',
      actual: [outcomes.every((value) => value === null), f.calls.length],
      expected: [true, 0],
    })
  } finally {
    await f.clean()
  }
})

test('Unavailable or malformed Jev responses fall back without retrying or caching a skip', async () => {
  const cases = [
    () => new Response('Unavailable', { status: 503 }),
    () => new Response('Refused', { status: 401 }),
    () => response({ ...quiet, direct_request: -1 }),
    () => response({ ...quiet, uncertain_context: 2 }),
    () => response({ direct_request: 0 }),
  ]
  for (const respond of cases) {
    const f = await fixture()
    try {
      f.control.response = respond
      const screen = f.screen()
      const input = { conversation: conversation(), prior: null, cache: f.cache }
      const first = await screen.assess(input)
      const second = await screen.assess(input)
      f.control.response = () => response()
      const recovered = await f.screen().assess(input)
      assert({
        given: 'a provider error or invalid probabilities during a scan',
        should: 'fall back once for that scan and retry on the next without a false cached negative',
        actual: [first, second, recovered?.skipped, f.calls.length],
        expected: [null, null, true, 2],
      })
    } finally {
      await f.clean()
    }
  }
})

test('A stalled Jev request is aborted once and leaves full analysis available', async () => {
  const f = await fixture()
  try {
    let aborted = false
    f.control.response = (init) =>
      new Promise((_resolve, reject) => {
        init!.signal!.addEventListener(
          'abort',
          () => {
            aborted = true
            reject(init!.signal!.reason)
          },
          { once: true },
        )
      })
    const input = { conversation: conversation(), prior: null, cache: f.cache }
    const screen = f.screen()
    const verdict = await screen.assess(input)
    const next = await screen.assess(input)
    assert({
      given: 'a provider that never answers',
      should: 'abort the request, fall back, and avoid another timeout on the next conversation',
      actual: [verdict, next, aborted, f.calls.length],
      expected: [null, null, true, 1],
    })
  } finally {
    await f.clean()
  }
})

test('A missing TypeSafe key leaves the existing pipeline available without reaching the provider', async () => {
  const f = await fixture()
  try {
    await f.secrets.delete('typesafe', 'main')
    const verdict = await f.screen().assess({ conversation: conversation(), prior: null, cache: f.cache })
    assert({
      given: 'no TypeSafe connection',
      should: 'return to normal analysis without a network request',
      actual: [verdict, f.calls.length],
      expected: [null, 0],
    })
  } finally {
    await f.clean()
  }
})

test('A corrupted screen receipt remains an error instead of silently hiding a conversation', async () => {
  const f = await fixture()
  try {
    const input = { conversation: conversation(), prior: null, cache: f.cache }
    await f.screen().assess(input)
    const dir = path.join(f.cache.dir, 'screens')
    const file = (await readdir(dir))[0]
    await writeFile(path.join(dir, file), '{"broken":true}')
    let failed = false
    try {
      await f.screen().assess(input)
    } catch {
      failed = true
    }
    assert({
      given: 'a damaged derived result',
      should: 'fail visibly without resetting or trusting it',
      actual: [failed, f.calls.length],
      expected: [true, 1],
    })
  } finally {
    await f.clean()
  }
})
