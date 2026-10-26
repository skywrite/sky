import { createSecret } from '#lib/secrets/marshal.ts'
import { TestSecretsProvider } from '#lib/secrets/TestSecretsProvider.ts'
import { createTypeSafeClient } from '#shared/ai/typesafe/client.ts'
import type { AIUsageRecord } from '#shared/ai/usageLog.ts'
import { assert, test } from '#test'
import { createChatDayCategorizer, type ChatDayCategoryInput } from './chatDayCategory.ts'

const chat: ChatDayCategoryInput = {
  summary: 'Birthday dinner',
  transcript: "Jane: What should we cook for my sister's birthday on Saturday?",
}

function answer(category: 'Personal' | 'Professional', probability = 0.98, confidence = probability) {
  return {
    model: 'jev-test',
    answers: {
      day_category: {
        type: 'choice',
        choice: category,
        confidence,
        probabilities: { Personal: 1 - probability, Professional: 1 - probability, [category]: probability },
      },
    },
    usage: { input_tokens: 100, output_tokens: 0 },
  }
}

function fixture(signal?: AbortSignal) {
  const calls: Array<{ state: { title: string; conversation: string }; questions: Record<string, unknown> }> = []
  const usage: AIUsageRecord[] = []
  const warnings: string[] = []
  const control = { response: () => Response.json(answer('Personal')) }
  const categorize = createChatDayCategorizer({
    signal,
    client: createTypeSafeClient({
      secrets: new TestSecretsProvider({ 'typesafe/main': createSecret('synthetic-key') }),
      fetch: (async (_url, init) => {
        calls.push(JSON.parse(String(init?.body)))
        return control.response()
      }) as typeof fetch,
    }),
    sink: (record) => {
      usage.push(record)
    },
    warn: (message) => warnings.push(message),
  })
  return { calls, control, usage, warnings, categorize }
}

test('chat day sections favor Personal and require clear Professional probability', async () => {
  const f = fixture()
  const results: string[] = []
  for (const [category, probability, confidence] of [
    ['Personal', 0.95, 0.95],
    ['Personal', 0.58, 0.9],
    ['Professional', 0.84, 0.99],
    ['Professional', 0.85, 0.1],
  ] as const) {
    f.control.response = () => Response.json(answer(category, probability, confidence))
    results.push(await f.categorize(chat))
  }
  assert({
    given: 'personal chats, an uncertain work judgment and a clear work judgment with low distribution confidence',
    should: 'favor Personal below the work threshold, use probability rather than confidence, and log usage',
    actual: [results, f.usage.map((entry) => entry.provider)],
    expected: [
      ['Personal', 'Personal', 'Personal', 'Professional'],
      ['typesafe', 'typesafe', 'typesafe', 'typesafe'],
    ],
  })
})

test('a chat is judged by its title and complete conversation, with Personal on failure', async () => {
  const f = fixture()
  await f.categorize(chat)
  f.control.response = () => Response.json({ message: 'Synthetic outage' }, { status: 503 })
  const failed = await f.categorize(chat)
  f.control.response = () => Response.json(answer('Professional'))
  const recovered = await f.categorize(chat)
  assert({
    given: 'a saved chat, a service outage, then a later available judgment',
    should: 'send only title and conversation, fall back to Personal without retrying, and recover for the next chat',
    actual: [f.calls[0].state, Object.keys(f.calls[0].questions), failed, recovered, f.calls.length, f.warnings.length],
    expected: [
      { title: chat.summary, conversation: chat.transcript },
      ['day_category'],
      'Personal',
      'Professional',
      3,
      1,
    ],
  })
})

test('invalid or contradictory chat day answers never become Professional', async () => {
  const f = fixture()
  const valid = answer('Professional').answers.day_category
  const results: string[] = []
  for (const invalid of [
    { ...valid, choice: 'Business' },
    { ...valid, probabilities: { Personal: 0.8, Professional: 0.98 } },
    { ...valid, probabilities: { Personal: 0.95, Professional: 0.05 } },
    { ...valid, probabilities: { Personal: -0.1, Professional: 1.1 } },
    { ...valid, confidence: 2 },
    { ...valid, probabilities: {} },
  ]) {
    f.control.response = () => Response.json({ ...answer('Professional'), answers: { day_category: invalid } })
    results.push(await f.categorize(chat))
  }
  assert({
    given: 'invalid labels, invalid probabilities, a contradictory choice and malformed confidence',
    should: 'default to Personal for each unusable answer',
    actual: results,
    expected: Array(6).fill('Personal'),
  })
})

test('missing or oversized chat evidence stays Personal without submitting a partial conversation', async () => {
  const f = fixture()
  f.control.response = () => Response.json(answer('Professional'))
  const results: string[] = []
  for (const input of [
    { ...chat, transcript: '  ' },
    { ...chat, transcript: 'work '.repeat(5000) },
    { ...chat, summary: 'work '.repeat(5000) },
  ])
    results.push(await f.categorize(input))
  assert({
    given: 'an empty transcript, an oversized conversation, and an oversized title',
    should: 'leave ambiguous evidence under Personal and make no model requests',
    actual: [results, f.calls.length],
    expected: [['Personal', 'Personal', 'Personal'], 0],
  })
})

test('a missing Jev key does not prevent a chat from getting a day category', async () => {
  let requests = 0
  const categorize = createChatDayCategorizer({
    client: createTypeSafeClient({
      secrets: new TestSecretsProvider({}),
      fetch: (async (_url, _init) => {
        requests++
        return Response.json(answer('Professional'))
      }) as typeof fetch,
    }),
    sink: () => {},
  })
  assert({
    given: 'a notebook without a TypeSafe key',
    should: 'choose Personal without sending an unauthenticated request',
    actual: [await categorize(chat), requests],
    expected: ['Personal', 0],
  })
})

test('cancelled chat categorization propagates cancellation', async () => {
  const controller = new AbortController()
  const f = fixture(controller.signal)
  f.control.response = () => {
    controller.abort(new Error('Synthetic cancellation'))
    return Response.json({ message: 'Synthetic outage' }, { status: 503 })
  }
  const outcomes: string[] = []
  for (let i = 0; i < 2; i++) {
    try {
      outcomes.push(await f.categorize(chat))
    } catch (err) {
      outcomes.push((err as Error).message)
    }
  }
  assert({
    given: 'a request cancelled in flight, then another call with the already-cancelled signal',
    should: 'propagate cancellation both times and make only the first request',
    actual: [outcomes, f.calls.length, f.warnings.length],
    expected: [['Synthetic cancellation', 'Synthetic cancellation'], 1, 0],
  })
})
