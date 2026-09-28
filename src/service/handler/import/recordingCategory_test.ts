import { createSecret } from '#lib/secrets/marshal.ts'
import { TestSecretsProvider } from '#lib/secrets/TestSecretsProvider.ts'
import { createTypeSafeClient } from '#shared/ai/typesafe/client.ts'
import type { AIUsageRecord } from '#shared/ai/usageLog.ts'
import { assert, test } from '#test'
import { recordingCategory } from './recordingCategory.ts'

function answer(category: 'Professional' | 'Personal') {
  return {
    type: 'choice',
    choice: category,
    confidence: 0.9,
    probabilities: { Professional: 0.1, Personal: 0.1, [category]: 0.9 },
  }
}

function response(value: unknown) {
  return Response.json({
    model: 'jev-test',
    answers: { category: value },
    usage: { input_tokens: 80, output_tokens: 0 },
  })
}

function fixture() {
  const calls: Array<{ state: { opening: string }; questions: unknown }> = []
  const usage: AIUsageRecord[] = []
  const control = {
    respond: (_signal?: AbortSignal | null): Response | Promise<Response> => response(answer('Personal')),
  }
  const secrets = new TestSecretsProvider({ 'typesafe/main': createSecret('tsk-test-key') })
  const client = createTypeSafeClient({
    secrets,
    fetch: (async (_url, init) => {
      calls.push(JSON.parse(String(init?.body)))
      return control.respond(init?.signal)
    }) as typeof fetch,
  })
  return {
    calls,
    usage,
    control,
    secrets,
    classify: (text: string) => recordingCategory(client, text, { sink: (record) => void usage.push(record) }),
  }
}

test('voice memo categories use Jev with only the first three sentences and record usage', async () => {
  const f = fixture()
  const opening = 'I went hiking with friends. We planned another trip. It will be a relaxing weekend.'
  const personal = await f.classify(`  ${opening} Next I want to talk about the Atlas release.  `)
  f.control.respond = () => response(answer('Professional'))
  const professional = await f.classify('We reviewed the Atlas release with Jane Doe.')
  assert({
    given: 'personal and professional openings followed by unrelated later content',
    should: 'use the returned category and send only the opening sentences through the metered Jev client',
    actual: [personal, professional, f.calls.map((call) => call.state), f.usage.map(({ provider }) => provider)],
    expected: [
      'Personal',
      'Professional',
      [{ opening }, { opening: 'We reviewed the Atlas release with Jane Doe.' }],
      ['typesafe', 'typesafe'],
    ],
  })
})

test('empty transcripts skip Jev and unpunctuated transcripts stay bounded', async () => {
  const f = fixture()
  const empty = await f.classify(' \n\t ')
  await f.classify('word '.repeat(1000))
  assert({
    given: 'no transcript or a long opening without sentence punctuation',
    should: 'skip empty input and bound the text sent to the classifier',
    actual: [empty, f.calls.length, f.calls[0].state.opening],
    expected: [undefined, 1, 'word '.repeat(300).trim()],
  })
})

test('unusable Jev answers leave the category unset', async () => {
  const f = fixture()
  const invalid = [
    { ...answer('Personal'), choice: 'Unknown' },
    { ...answer('Personal'), probabilities: { Personal: 0.5, Professional: 0.5 } },
    { ...answer('Personal'), probabilities: { Personal: 0.9, Professional: 0.9 } },
    { ...answer('Personal'), probabilities: { Personal: 0.1, Professional: 0.9 } },
    { ...answer('Personal'), probabilities: { Personal: -1, Professional: 2 } },
    null,
  ]
  const categories: Array<'Professional' | 'Personal' | undefined> = []
  for (const value of invalid) {
    f.control.respond = () => response(value)
    categories.push(await f.classify('A recap of the weekend.'))
  }
  assert({
    given: 'an unknown category, a tie, inconsistent probabilities or a malformed answer',
    should: 'offer no automatic category',
    actual: categories,
    expected: invalid.map(() => undefined),
  })
})

test('a missing key or unavailable Jev does not fail the preview or retry the request', async () => {
  const f = fixture()
  f.control.respond = () => Response.json({ error: 'Unavailable' }, { status: 503 })
  const unavailable = await f.classify('A recap of the weekend.')
  const withoutKey = fixture()
  await withoutKey.secrets.delete('typesafe', 'main')
  const missing = await withoutKey.classify('A recap of the weekend.')
  assert({
    given: 'an unavailable provider followed by a missing key',
    should: 'return no suggestion and make no retries or unauthenticated requests',
    actual: [unavailable, missing, f.calls.length + withoutKey.calls.length, f.usage.length],
    expected: [undefined, undefined, 1, 0],
  })
})

test('a stalled Jev request is aborted and leaves the preview available', async () => {
  const f = fixture()
  let aborted = false
  f.control.respond = (signal) =>
    new Promise((_resolve, reject) => {
      signal?.addEventListener(
        'abort',
        () => {
          aborted = true
          reject(new DOMException('Timed out', 'AbortError'))
        },
        { once: true },
      )
    })
  const category = await f.classify('A recap of the weekend.')
  assert({
    given: 'a provider that never answers',
    should: 'abort the single request and return no suggestion',
    actual: [category, aborted, f.calls.length],
    expected: [undefined, true, 1],
  })
})
