import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { MockLanguageModelV4 } from 'ai/test'
import { assert, test } from '#test'
import { AnalysisCache } from './analysisCache.ts'
import { requestUnits } from './requestAnalysis.ts'
import { createRequestAttention, type OwnerInitiative } from './requestAttention.ts'
import { requestNeedsReply, type RequestRecord } from './requestTypes.ts'
import { createTriage } from './triage.ts'
import type { Conversation } from './types.ts'

const PROFILE = '---\nname: Alex Example\n---\nI lead Example Company.'
const REF = '2025-03-15/actions/messages/slack_Atlas.md'
const conversation = (body: string): Conversation => ({
  key: 'atlas',
  version: 'v1',
  medium: 'Slack',
  sources: [{ ref: REF, hash: 'v1', from: 'Jane Doe', to: '#engineering', body }],
  target: null,
  limitations: [],
})
const message = (author: string, body: string) => `## 2025-03-15 09:00 - **${author}**\n${body}`

function candidate(conversation: Conversation, quote: string): RequestRecord {
  const unit = requestUnits(conversation).find((unit) => unit.text.includes(quote))!
  return {
    id: 'a'.repeat(32),
    summary: quote,
    origin: { kind: 'message', ref: REF, message: unit.message, at: unit.at, quote },
    status: 'uncertain',
    context: '',
    explanation: 'The old reader did not establish ownership.',
    evidence: [],
    resolution: null,
    present: true,
    reports: [],
  }
}

async function fixture(respond: (input: any) => any, initiatives: OwnerInitiative[] = []) {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-outbox-attention-test-'))
  const calls: any[] = []
  const model = new MockLanguageModelV4({
    doGenerate: async ({ prompt }) => {
      const user = prompt.find((message) => message.role === 'user')!
      const input = JSON.parse(
        user.content
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join(''),
      )
      calls.push(input)
      return {
        content: [{ type: 'text', text: JSON.stringify(respond(input)) }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1, text: 1, reasoning: 0 },
        },
        warnings: [],
      }
    },
  })
  const resolve = () => ({ model, maxRetries: 0 })
  return {
    calls,
    resolve,
    cache: new AnalysisCache(root, 'atlas'),
    attention: createRequestAttention({ ownerContext: PROFILE, initiatives, today: '2025-03-15', model: resolve }),
    propose: createTriage(PROFILE, resolve),
    clean: () => rm(root, { recursive: true, force: true }),
  }
}

test('Unproven ownership and waiting on another person produce no Outbox question or draft', async () => {
  const outcomes: unknown[] = []
  for (const action of ['none', 'waiting']) {
    const f = await fixture((input) => {
      if (!input.candidate) throw new Error('An irrelevant candidate must never reach reply planning.')
      return {
        id: input.candidate.id,
        action,
        basis: 'none',
        explanation:
          action === 'none'
            ? 'This is a broad call for testers, not a request to you.'
            : 'Jane owns the next response.',
        evidence: [],
        initiative: null,
      }
    })
    try {
      const quote = 'Could anyone test the retry fix?'
      const saved = conversation(message('Jane Doe', quote))
      const requests = await f.attention.assess(saved, [candidate(saved, quote)], f.cache)
      const proposal = await f.propose({
        conversation: saved,
        requests,
        requestCache: f.cache,
        today: '2025-03-15',
        now: '2025-03-15 12:00',
        preferences: '',
        examples: [],
      })
      outcomes.push([
        action,
        requests[0].status,
        requestNeedsReply(requests[0]),
        proposal.action,
        proposal.questions,
        proposal.draft,
        f.calls.length,
      ])
    } finally {
      await f.clean()
    }
  }
  assert({
    given: 'the earlier reader labeled ownership uncertain',
    should: 'keep absent ownership and someone else’s turn out of the review queue',
    actual: outcomes,
    expected: [
      ['none', 'uncertain', false, 'ignore', [], '', 1],
      ['waiting', 'uncertain', false, 'ignore', [], '', 1],
    ],
  })
})

test('Owner requests require grounded address, participation, commitment or initiative evidence', async () => {
  const outcomes: unknown[] = []
  for (const mode of [
    'no-basis',
    'no-evidence',
    'wrong-person',
    'false-participation',
    'unknown-initiative',
    'invented-quote',
    'direct',
    'participation',
    'initiative',
  ]) {
    const initiatives = [
      {
        ref: 'projects/open/Atlas/_project/overview.md',
        title: 'Atlas pilot',
        context: 'Alex chooses the pilot scope and approves the release budget.',
      },
    ]
    const f = await fixture((input) => {
      const quote = input.candidate.origin
      const owner = input.conversation.sources.find((source: any) => source.ownerAuthored)
      return {
        id: input.candidate.id,
        action: 'reply',
        basis:
          mode === 'no-basis'
            ? 'none'
            : mode === 'false-participation' || mode === 'participation'
              ? 'active_exchange'
              : mode.includes('initiative')
                ? 'initiative_decision'
                : 'direct_request',
        explanation: 'The pilot scope needs your decision.',
        evidence:
          mode === 'no-evidence'
            ? []
            : mode === 'invented-quote'
              ? [{ ...quote, quote: 'An invented tag.' }]
              : mode === 'participation'
                ? [quote, { ref: owner.ref, message: owner.message, quote: 'Bring me the pilot alternatives.' }]
                : [quote],
        initiative:
          mode === 'unknown-initiative'
            ? 'projects/open/Unknown/_project/overview.md'
            : mode === 'initiative'
              ? initiatives[0].ref
              : null,
      }
    }, initiatives)
    try {
      const quote =
        mode === 'wrong-person' ? '@Sam, can you choose the pilot scope?' : '@Alex, can you choose the pilot scope?'
      const saved = conversation(
        message('Alex Example', 'Bring me the pilot alternatives.') + '\n\n' + message('Jane Doe', quote),
      )
      let accepted = false
      try {
        accepted = requestNeedsReply((await f.attention.assess(saved, [candidate(saved, quote)], f.cache))[0])
      } catch {
        /* Invalid model evidence cannot publish an item. */
      }
      outcomes.push([mode, accepted])
    } finally {
      await f.clean()
    }
  }
  assert({
    given: 'structured relevance claims, including plausible but unsupported ownership',
    should: 'accept only verified connections and retain a real owner decision despite an uncertain earlier label',
    actual: outcomes,
    expected: [
      ['no-basis', false],
      ['no-evidence', false],
      ['wrong-person', false],
      ['false-participation', false],
      ['unknown-initiative', false],
      ['invented-quote', false],
      ['direct', true],
      ['participation', true],
      ['initiative', true],
    ],
  })
})

test('An invalid quote gets one correction attempt and only the verified result is reusable', async () => {
  const f = await fixture((input) => ({
    id: input.candidate.id,
    action: 'reply',
    basis: 'direct_request',
    explanation: 'Jane directly requests your scope decision.',
    evidence: [
      {
        ...input.candidate.origin,
        quote: input.correction ? input.candidate.origin.quote : '@Alex, choose the changed scope.',
      },
    ],
    initiative: null,
  }))
  try {
    const quote = '@Alex, can you choose the pilot scope?'
    const saved = conversation(message('Jane Doe', quote))
    const records = [candidate(saved, quote)]
    const first = await f.attention.assess(saved, records, f.cache)
    const repeated = await f.attention.assess(saved, records, f.cache)
    assert({
      given: 'a plausible model answer that misquotes its evidence on the first attempt',
      should: 'request an exact correction and reuse only the grounded result on retry',
      actual: [f.calls.length, requestNeedsReply(first[0]), first[0].attention?.evidence[0].quote, repeated],
      expected: [2, true, quote, first],
    })
  } finally {
    await f.clean()
  }
})

test('Initiative changes recheck attention while unchanged relevance uses its validated receipt', async () => {
  const f = await fixture((input) => ({
    id: input.candidate.id,
    action: 'none',
    basis: 'none',
    explanation: 'No personal obligation is established.',
    evidence: [],
    initiative: null,
  }))
  try {
    const quote = 'The Atlas pilot is waiting for a scope decision.'
    const saved = conversation(message('Jane Doe', quote))
    const records = [candidate(saved, quote)]
    const first = await f.attention.assess(saved, records, f.cache)
    const repeated = await f.attention.assess(saved, records, f.cache)
    assert({
      given: 'an unchanged request and owner context',
      should: 'reuse the attention decision without asking the model or owner again',
      actual: [f.calls.length, repeated],
      expected: [1, first],
    })
    const changed = createRequestAttention({
      ownerContext: PROFILE,
      today: '2025-03-15',
      model: f.resolve,
      initiatives: [{ ref: 'workstreams/Atlas', title: 'Atlas pilot', context: 'Alex chooses the pilot scope.' }],
    })
    await changed.assess(saved, records, f.cache)
    assert({
      given: 'a newly declared active initiative that could establish ownership',
      should: 'invalidate the prior attention decision and the completed scan fingerprint',
      actual: [f.calls.length, (await changed.version()) !== (await f.attention.version())],
      expected: [2, true],
    })
  } finally {
    await f.clean()
  }
})
