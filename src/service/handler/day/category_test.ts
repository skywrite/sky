import { createSecret } from '#lib/secrets/marshal.ts'
import { TestSecretsProvider } from '#lib/secrets/TestSecretsProvider.ts'
import { createTypeSafeClient, JEV_MODEL } from '#shared/ai/typesafe/client.ts'
import type { AIUsageRecord } from '#shared/ai/usageLog.ts'
import { assert, test } from '#test'
import { createItemCategorizer, createItemCategoryRoutes, type ItemCategory } from './category.ts'

function answer(category: ItemCategory) {
  return {
    model: 'jev-test',
    answers: {
      day_category: {
        type: 'choice',
        choice: category,
        confidence: 0.98,
        probabilities: { Personal: 0.02, Professional: 0.02, [category]: 0.98 },
      },
    },
    usage: { input_tokens: 100, output_tokens: 0 },
  }
}

function fixture(hasKey = true) {
  const calls: Array<{ model: string; state: unknown; questions: Record<string, unknown> }> = []
  const usage: AIUsageRecord[] = []
  const control = { response: () => Response.json(answer('Personal')) }
  const categorize = createItemCategorizer({
    client: createTypeSafeClient({
      secrets: new TestSecretsProvider(hasKey ? { 'typesafe/main': createSecret('synthetic-key') } : {}),
      fetch: (async (_url, init) => {
        calls.push(JSON.parse(String(init?.body)))
        return control.response()
      }) as typeof fetch,
    }),
    sink: (record) => {
      usage.push(record)
    },
  })
  const app = createItemCategoryRoutes(categorize)
  const send = (body: unknown, headers: Record<string, string> = {}, ymd = '2026-01-27') =>
    app.request(`/${ymd}/item/category`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })
  return { app, categorize, send, calls, usage, control }
}

test('day item suggestions ask the pinned Jev for one category and record usage', async () => {
  const f = fixture()
  const personal = await f.send({ text: '  Water the plants  ' })
  f.control.response = () => Response.json(answer('Professional'))
  const professional = await f.send({ text: 'Prepare the Atlas proposal' })
  assert({
    given: 'a personal activity and a work task in a draft composer',
    should: 'return each category using only the item text as evidence and log both decisions',
    actual: [
      await personal.json(),
      await professional.json(),
      f.calls.map((call) => [call.model, call.state, Object.keys(call.questions)]),
      f.usage.map((record) => [record.provider, record.model, record.input]),
    ],
    expected: [
      { category: 'Personal' },
      { category: 'Professional' },
      [
        [JEV_MODEL, { text: 'Water the plants' }, ['day_category']],
        [JEV_MODEL, { text: 'Prepare the Atlas proposal' }, ['day_category']],
      ],
      [
        ['typesafe', 'jev-test', 100],
        ['typesafe', 'jev-test', 100],
      ],
    ],
  })
})

test('invalid drafts and cross-site category requests never reach Jev', async () => {
  const f = fixture()
  const requests = [
    await f.send({ text: '' }),
    await f.send({ text: '   ' }),
    await f.send({ text: 123 }),
    await f.send(null),
    await f.send({ text: 'A'.repeat(4001) }),
    await f.send({ text: 'Water the plants' }, {}, '2026-02-30'),
    await f.send({ text: 'Water the plants' }, { 'content-type': 'text/plain' }),
    await f.send({ text: 'Water the plants' }, { origin: 'https://example.com' }),
    await f.send({ text: 'Water the plants' }, { 'sec-fetch-site': 'cross-site' }),
    await f.send({ text: 'A'.repeat(32_001) }),
  ]
  assert({
    given: 'empty, invalid, oversized and cross-site requests',
    should: 'refuse them before spending a model request',
    actual: [requests.map((response) => response.status), f.calls.length],
    expected: [[400, 400, 400, 400, 400, 400, 400, 403, 403, 413], 0],
  })
})

test('unavailable or malformed category decisions leave the dropdown choice to the person', async () => {
  const f = fixture()
  const valid = answer('Personal')
  const replies: Array<() => Response> = [
    () => Response.json({ message: 'Synthetic outage' }, { status: 503 }),
    () => Response.json({ ...valid, answers: { day_category: { ...valid.answers.day_category, choice: 'Other' } } }),
    () =>
      Response.json({
        ...valid,
        answers: {
          day_category: { ...valid.answers.day_category, probabilities: { Personal: 0.9, Professional: 0.9 } },
        },
      }),
    () =>
      Response.json({
        ...valid,
        answers: {
          day_category: { ...valid.answers.day_category, probabilities: { Personal: 0.02, Professional: 0.98 } },
        },
      }),
  ]
  const results: unknown[] = []
  for (const response of replies) {
    f.control.response = response
    results.push(await (await f.send({ text: 'Water the plants' })).json())
  }
  const missing = fixture(false)
  results.push(await (await missing.send({ text: 'Water the plants' })).json())
  f.control.response = () => Response.json(answer('Personal'))
  assert({
    given: 'an outage, invalid answers, a missing key, then a recovered provider',
    should: 'return no suggestion without retries, make no unauthenticated request, and allow the next draft to retry',
    actual: [results, f.calls.length, missing.calls.length, await (await f.send({ text: 'Water the plants' })).json()],
    expected: [Array(5).fill({ category: null }), 4, 0, { category: 'Personal' }],
  })
})

test('an aborted category request never starts a model request', async () => {
  const f = fixture()
  const controller = new AbortController()
  controller.abort()
  let aborted = false
  try {
    await f.categorize('Water the plants', controller.signal)
  } catch {
    aborted = true
  }
  assert({
    given: 'a draft already superseded before classification starts',
    should: 'observe cancellation without calling the provider',
    actual: [aborted, f.calls.length],
    expected: [true, 0],
  })
})
