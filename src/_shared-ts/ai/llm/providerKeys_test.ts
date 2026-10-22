import { assert, test } from '#test'
import { checkProviderKey, PROVIDER_KEY_IDS, type ProviderKeyId } from './providerKeys.ts'

// The providers are scripted: no network, no real key.

const KEY = 'sk-atlas-test-key'

function answering(status: number, body: unknown = {}) {
  const calls: Array<{ url: string; headers: Headers }> = []
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), headers: new Headers(init?.headers) })
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  return { calls, fetch: fetchFn }
}

const failing = (error: unknown) => (() => Promise.reject(error)) as unknown as typeof fetch

test('each provider is asked for its models, signed the way it reads keys', async () => {
  const asked: Record<string, unknown> = {}
  for (const id of PROVIDER_KEY_IDS) {
    const provider = answering(200, { data: [] })
    const check = await checkProviderKey(id, KEY, provider.fetch)
    const call = provider.calls[0]
    asked[id] = {
      check,
      url: call?.url,
      key: call?.headers.get('x-api-key') ?? call?.headers.get('authorization'),
      version: call?.headers.get('anthropic-version'),
    }
  }
  assert({
    given: 'a key each provider accepts',
    should: 'ask the models endpoint with the key in the provider’s header',
    actual: asked,
    expected: {
      anthropic: {
        check: { ok: true },
        url: 'https://api.anthropic.com/v1/models?limit=1',
        key: KEY,
        version: '2023-06-01',
      },
      openai: { check: { ok: true }, url: 'https://api.openai.com/v1/models', key: `Bearer ${KEY}`, version: null },
      cerebras: { check: { ok: true }, url: 'https://api.cerebras.ai/v1/models', key: `Bearer ${KEY}`, version: null },
    },
  })
})

test('a refused key keeps the provider’s own words', async () => {
  const cases: Array<[ProviderKeyId, number, unknown]> = [
    ['anthropic', 401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }],
    ['openai', 403, { error: { message: 'Missing scopes: api.model.read.' } }],
    ['cerebras', 401, { message: 'Wrong API Key' }],
  ]
  const answers = await Promise.all(
    cases.map(([id, status, body]) => checkProviderKey(id, KEY, answering(status, body).fetch)),
  )
  assert({
    given: 'a 401 or 403 from each provider',
    should: 'read as refused, with what the provider said',
    actual: answers,
    expected: [
      { ok: false, refused: true, message: 'Anthropic refused the key. invalid x-api-key' },
      { ok: false, refused: true, message: 'OpenAI refused the key. Missing scopes: api.model.read.' },
      { ok: false, refused: true, message: 'Cerebras refused the key. Wrong API Key' },
    ],
  })
})

test('a provider that cannot answer is not a refusal', async () => {
  const answers = await Promise.all([
    checkProviderKey('openai', KEY, answering(503).fetch),
    checkProviderKey('openai', KEY, failing(new TypeError('fetch failed'))),
    checkProviderKey('anthropic', KEY, failing(new DOMException('The operation timed out.', 'TimeoutError'))),
  ])
  assert({
    given: 'an outage, no network, and a timeout',
    should: 'say so without calling the key refused',
    actual: answers,
    expected: [
      { ok: false, refused: false, message: 'OpenAI answered 503.' },
      { ok: false, refused: false, message: 'OpenAI could not be reached.' },
      { ok: false, refused: false, message: 'Anthropic did not answer in time.' },
    ],
  })
})
