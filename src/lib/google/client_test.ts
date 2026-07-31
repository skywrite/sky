import { assert, test } from '#test'
import { TestSecretsProvider } from '#lib/secrets/TestSecretsProvider.ts'
import { GOOGLE_TOKEN_URL } from './oauth.ts'
import { loadAccountTokens, saveAccountTokens } from './tokens.ts'
import { GoogleApiError, GoogleClient } from './client.ts'

const EMAIL = 'jane@example.com'
const OAUTH_CLIENT = { clientId: 'id', clientSecret: 'sec' }

interface Call {
  url: string
  authorization?: string
}

/** Route fake responses by URL; records every call. */
function fakeFetch(calls: Call[], respond: (url: string, call: number) => Response): typeof fetch {
  return (async (url: unknown, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>
    calls.push({ url: String(url), authorization: headers.Authorization })
    return respond(String(url), calls.length)
  }) as typeof fetch
}

function tokenResponse(accessToken: string): Response {
  return new Response(JSON.stringify({ access_token: accessToken, expires_in: 3600 }), { status: 200 })
}

test('GoogleClient refreshes a missing access token and persists it', async () => {
  const secrets = new TestSecretsProvider()
  await saveAccountTokens(secrets, EMAIL, { refreshToken: 'rt-1', scopes: [] })

  const calls: Call[] = []
  const fetchFn = fakeFetch(calls, (url) => {
    if (url === GOOGLE_TOKEN_URL) return tokenResponse('at-1')
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  })

  const client = new GoogleClient({ secrets, email: EMAIL, client: OAUTH_CLIENT, fetchFn, sleep: async () => {} })
  const body = await client.getJson<{ ok: boolean }>('https://www.googleapis.com/drive/v3/files?q=x')

  assert({
    given: 'a stored refresh token with no access token',
    should: 'hit the token endpoint first, then the API with the fresh token',
    expected: [GOOGLE_TOKEN_URL, 'Bearer at-1', true],
    actual: [calls[0]?.url, calls[1]?.authorization, body.ok],
  })

  const persisted = await loadAccountTokens(secrets, EMAIL)
  assert({
    given: 'a completed refresh',
    should: 'persist the new access token for later invocations',
    expected: 'at-1',
    actual: persisted?.accessToken,
  })
})

test('GoogleClient retries once with a forced refresh on 401', async () => {
  const secrets = new TestSecretsProvider()
  await saveAccountTokens(secrets, EMAIL, { refreshToken: 'rt-1', accessToken: 'stale', scopes: [] })

  const calls: Call[] = []
  const fetchFn = fakeFetch(calls, (url) => {
    if (url === GOOGLE_TOKEN_URL) return tokenResponse('at-2')
    const authorized = calls.some((c) => c.authorization === 'Bearer at-2')
    if (!authorized) return new Response('', { status: 401 })
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  })

  const client = new GoogleClient({ secrets, email: EMAIL, client: OAUTH_CLIENT, fetchFn, sleep: async () => {} })
  const body = await client.getJson<{ ok: boolean }>('https://www.googleapis.com/drive/v3/files')

  assert({
    given: 'a cached token the API rejects with 401',
    should: 'refresh once and retry: api, token endpoint, api',
    expected: ['Bearer stale', GOOGLE_TOKEN_URL, 'Bearer at-2', true],
    actual: [calls[0]?.authorization, calls[1]?.url, calls[2]?.authorization, body.ok],
  })

  const persisted = await loadAccountTokens(secrets, EMAIL)
  assert({
    given: 'a forced refresh',
    should: 'persist the replacement token',
    expected: 'at-2',
    actual: persisted?.accessToken,
  })
})

test('GoogleClient surfaces API errors', async () => {
  const secrets = new TestSecretsProvider()
  await saveAccountTokens(secrets, EMAIL, { refreshToken: 'rt-1', accessToken: 'at-1', scopes: [] })

  const calls: Call[] = []
  const fetchFn = fakeFetch(
    calls,
    () => new Response(JSON.stringify({ error: { message: 'File not found: abc' } }), { status: 404 }),
  )

  const client = new GoogleClient({ secrets, email: EMAIL, client: OAUTH_CLIENT, fetchFn, sleep: async () => {} })

  let caught: unknown
  try {
    await client.getJson('https://www.googleapis.com/drive/v3/files/abc')
  } catch (err) {
    caught = err
  }

  assert({
    given: 'a 404 from the API',
    should: 'throw GoogleApiError with status and message',
    expected: [true, 404, true],
    actual: [
      caught instanceof GoogleApiError,
      (caught as GoogleApiError)?.status,
      String((caught as Error)?.message).includes('File not found'),
    ],
  })
})
