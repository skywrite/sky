import { createSecret } from '#lib/secrets/marshal.ts'
import { TestSecretsProvider } from '#lib/secrets/TestSecretsProvider.ts'
import { createTypeSafeClient } from '#shared/ai/typesafe/client.ts'
import type { AIUsageRecord } from '#shared/ai/usageLog.ts'
import { assert, test } from '#test'
import { createChatDayCategorizer, type ChatDayCategoryInput } from './chatDayCategory.ts'

const chat: ChatDayCategoryInput = {
  summary: 'Birthday dinner',
  transcript: "User: What should we cook for my sister's birthday on Saturday?",
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
  })
  return { calls, control, usage, categorize }
}

/** The chosen section, or 'rejected' when the save would keep its own category. */
async function outcome(categorizing: Promise<string>): Promise<string> {
  try {
    return await categorizing
  } catch {
    return 'rejected'
  }
}

test('chat day sections lean Professional and need a clear Personal probability', async () => {
  const f = fixture()
  const results: string[] = []
  for (const [category, probability, confidence] of [
    ['Personal', 0.95, 0.95],
    ['Personal', 0.58, 0.9],
    ['Professional', 0.7, 0.99],
    ['Personal', 0.6, 0.1],
  ] as const) {
    f.control.response = () => Response.json(answer(category, probability, confidence))
    results.push(await f.categorize(chat))
  }
  assert({
    given:
      'a clear personal chat, an unsure personal judgment, a work chat and a personal judgment with low confidence',
    should: 'lean Professional below the Personal threshold, use probability rather than confidence, and log usage',
    actual: [results, f.usage.map((entry) => entry.provider)],
    expected: [
      ['Personal', 'Professional', 'Professional', 'Personal'],
      ['typesafe', 'typesafe', 'typesafe', 'typesafe'],
    ],
  })
})

test('a chat is judged by its title and conversation, and a failed request rejects', async () => {
  const f = fixture()
  await f.categorize(chat)
  f.control.response = () => Response.json({ message: 'Synthetic outage' }, { status: 503 })
  const failed = await outcome(f.categorize(chat))
  f.control.response = () => Response.json(answer('Personal'))
  const recovered = await f.categorize(chat)
  assert({
    given: 'a saved chat, a service outage, then a later available judgment',
    should: 'send only title and conversation, reject without retrying, and recover for the next chat',
    actual: [f.calls[0].state, Object.keys(f.calls[0].questions), failed, recovered, f.calls.length],
    expected: [{ title: chat.summary, conversation: chat.transcript }, ['day_category'], 'rejected', 'Personal', 3],
  })
})

test('invalid or contradictory chat day answers never become Personal', async () => {
  const f = fixture()
  const valid = answer('Personal').answers.day_category
  const results: string[] = []
  for (const invalid of [
    { ...valid, choice: 'Family' },
    { ...valid, probabilities: { Personal: 0.98, Professional: 0.8 } },
    { ...valid, probabilities: { Personal: 0.05, Professional: 0.95 } },
    { ...valid, probabilities: { Personal: 1.1, Professional: -0.1 } },
    { ...valid, confidence: 2 },
    { ...valid, probabilities: {} },
  ]) {
    f.control.response = () => Response.json({ ...answer('Personal'), answers: { day_category: invalid } })
    results.push(await outcome(f.categorize(chat)))
  }
  assert({
    given: 'invalid labels, invalid probabilities, a contradictory choice and malformed confidence',
    should: 'reject each unusable answer, so the save keeps its own category',
    actual: results,
    expected: Array(6).fill('rejected'),
  })
})

test('a long chat is judged on its opening and ending', async () => {
  const f = fixture()
  const transcript =
    "User: Help me plan my sister's birthday dinner.\n\n" +
    'AI: Here is a long menu. '.repeat(5000) +
    '\n\nUser: Thanks, she will love it.'
  const result = await f.categorize({ summary: 'Birthday dinner', transcript })
  const sent = f.calls[0].state.conversation
  assert({
    given: 'a conversation far longer than the request budget',
    should: 'still ask, sending its opening and ending within the budget',
    actual: [
      result,
      sent.length <= 20_000,
      sent.startsWith("User: Help me plan my sister's birthday dinner."),
      sent.endsWith('she will love it.'),
    ],
    expected: ['Personal', true, true, true],
  })
})

test('without a Jev key, categorizing rejects without a request', async () => {
  let requests = 0
  const categorize = createChatDayCategorizer({
    client: createTypeSafeClient({
      secrets: new TestSecretsProvider({}),
      fetch: (async (_url, _init) => {
        requests++
        return Response.json(answer('Personal'))
      }) as typeof fetch,
    }),
    sink: () => {},
  })
  assert({
    given: 'a notebook without a TypeSafe key',
    should: 'reject without sending an unauthenticated request',
    actual: [await outcome(categorize(chat)), requests],
    expected: ['rejected', 0],
  })
})

test('a cancelled chat categorization asks nothing', async () => {
  const controller = new AbortController()
  controller.abort(new Error('Synthetic cancellation'))
  const f = fixture(controller.signal)
  let message = ''
  try {
    await f.categorize(chat)
  } catch (err) {
    message = (err as Error).message
  }
  assert({
    given: 'an already-cancelled signal',
    should: 'reject with the cancellation and make no request',
    actual: [message, f.calls.length],
    expected: ['Synthetic cancellation', 0],
  })
})
