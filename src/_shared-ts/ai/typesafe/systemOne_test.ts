import { noul } from '@typesafe-ai/sdk'
import { createSecret } from '#lib/secrets/marshal.ts'
import { TestSecretsProvider } from '#lib/secrets/TestSecretsProvider.ts'
import { type AIUsageRecord, runWithUsageSource } from '#shared/ai/usageLog.ts'
import { assert, test } from '#test'
import { createTypeSafeClient } from './client.ts'
import { askTypeSafe } from './systemOne.ts'

const ANSWER = JSON.stringify({
  model: 'jev-1.13.0',
  answers: { short: { type: 'noul', noul: 0.93 } },
  usage: { input_tokens: 57, output_tokens: 0 },
})

test('askTypeSafe asks with the keychain key and records the request in the usage log', async () => {
  const secrets = new TestSecretsProvider({ 'typesafe/main': createSecret('tsk-test-key') })
  const calls: { url: string; auth: string | null; body: string }[] = []
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), auth: new Headers(init?.headers).get('authorization'), body: String(init?.body) })
    return new Response(ANSWER, { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  const records: AIUsageRecord[] = []

  const result = await runWithUsageSource('ai:chat', () =>
    askTypeSafe(
      createTypeSafeClient({ secrets, fetch: fetchFn }),
      { state: 'Is this short?', questions: { short: noul('Is `state` short?') } },
      { sink: (record) => void records.push(record) },
    ),
  )
  const { ts: _ts, ...record } = records[0]
  assert({
    given: 'one yes/no question over a keychain client',
    should: 'post it signed to the systemone endpoint, answer typed, and log the model and input tokens under typesafe',
    actual: [
      calls[0]?.url,
      calls[0]?.auth,
      JSON.parse(calls[0]?.body ?? '{}'),
      result.answers.short.noul,
      records.length,
      record,
    ],
    expected: [
      'https://api.typesafe.ai/v1/systemone',
      'Bearer tsk-test-key',
      {
        state: 'Is this short?',
        questions: { short: { type: 'noul', instructions: 'Is `state` short?' } },
        model: 'jev-latest',
      },
      0.93,
      1,
      {
        source: 'ai:chat',
        provider: 'typesafe',
        model: 'jev-1.13.0',
        input: 57,
        cacheRead: 0,
        cacheWrite: 0,
        output: 0,
      },
    ],
  })
})
