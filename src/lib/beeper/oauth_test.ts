import { assert, test } from '#test'
import { BeeperError } from './client.ts'
import {
  buildBeeperAuthUrl,
  exchangeBeeperCode,
  grantExpired,
  grantExpiry,
  registerBeeperClient,
  startBeeperSignIn,
} from './oauth.ts'

type Call = { url: string; body: string; type: string }

function beeperFake(options: { register?: number; token?: number } = {}) {
  const calls: Call[] = []
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const headers = new Headers(init?.headers)
    calls.push({ url, body: typeof init?.body === 'string' ? init.body : '', type: headers.get('content-type') ?? '' })
    if (url.endsWith('/oauth/register'))
      return new Response(JSON.stringify({ client_id: 'sky-client', client_name: 'Sky' }), {
        status: options.register ?? 201,
      })
    if (url.endsWith('/oauth/token'))
      return new Response(
        JSON.stringify(
          options.token && options.token >= 400
            ? { error: 'invalid_grant', error_description: 'Code already used' }
            : { access_token: 'bpr-abc', token_type: 'Bearer', expires_in: 3600, scope: 'read write' },
        ),
        { status: options.token ?? 200 },
      )
    return new Response('{}', { status: 404 })
  }) as unknown as typeof fetch
  return { calls, fetchFn }
}

test('beeper sign-in - registration, the approval URL, and the code exchange follow the app’s OAuth contract', async () => {
  const { calls, fetchFn } = beeperFake()
  const clientId = await registerBeeperClient('http://127.0.0.1:5/oauth/callback', {
    fetchFn,
    baseUrl: 'http://127.0.0.1:1',
  })
  const url = new URL(
    buildBeeperAuthUrl({
      baseUrl: 'http://127.0.0.1:1',
      clientId,
      redirectUri: 'http://127.0.0.1:5/oauth/callback',
      challenge: 'ch',
      state: 'st',
    }),
  )
  const grant = await exchangeBeeperCode({
    fetchFn,
    baseUrl: 'http://127.0.0.1:1',
    code: 'code-1',
    verifier: 'ver',
    clientId,
    redirectUri: 'http://127.0.0.1:5/oauth/callback',
  })
  assert({
    given: 'a loopback redirect address',
    should: 'register a public client, ask for both scopes with S256, and read the token with its expiry',
    actual: [
      JSON.parse(calls[0].body),
      [url.pathname, Object.fromEntries(url.searchParams)],
      calls[1].type,
      Object.fromEntries(new URLSearchParams(calls[1].body)),
      [grant.token, grant.scope, grant.source, typeof grant.expiresAt],
    ],
    expected: [
      {
        client_name: 'Sky',
        redirect_uris: ['http://127.0.0.1:5/oauth/callback'],
        grant_types: ['authorization_code'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        scope: 'read write',
      },
      [
        '/oauth/authorize',
        {
          response_type: 'code',
          client_id: 'sky-client',
          redirect_uri: 'http://127.0.0.1:5/oauth/callback',
          scope: 'read write',
          state: 'st',
          code_challenge: 'ch',
          code_challenge_method: 'S256',
        },
      ],
      'application/x-www-form-urlencoded',
      {
        grant_type: 'authorization_code',
        code: 'code-1',
        code_verifier: 'ver',
        client_id: 'sky-client',
        redirect_uri: 'http://127.0.0.1:5/oauth/callback',
      },
      ['bpr-abc', 'read write', 'oauth', 'string'],
    ],
  })
})

test('beeper sign-in - a refused exchange names the app’s reason, and expiry has a minute of slack', async () => {
  const { fetchFn } = beeperFake({ token: 400 })
  const refused = await exchangeBeeperCode({
    fetchFn,
    baseUrl: 'http://127.0.0.1:1',
    code: 'c',
    verifier: 'v',
    clientId: 'x',
    redirectUri: 'http://127.0.0.1:5/oauth/callback',
  }).catch((error: unknown) => (error instanceof BeeperError ? `${error.kind}: ${error.message}` : 'other'))
  const at = 1_700_000_000_000
  assert({
    given: 'a used code, and grants around their expiry',
    should: 'say why, and read a grant as expired a minute early but never without an expiry',
    actual: [
      refused,
      grantExpiry(3600, at),
      grantExpired({ token: 't', source: 'oauth', expiresAt: grantExpiry(3600, at) }, at + 3600_000 - 61_000),
      grantExpired({ token: 't', source: 'oauth', expiresAt: grantExpiry(3600, at) }, at + 3600_000 - 59_000),
      grantExpired({ token: 't', source: 'pasted' }, at + 1e12),
      grantExpired({ token: 't', source: 'oauth', expiresAt: 'not a date' }, at),
    ],
    expected: ['request: Beeper sign-in failed: Code already used', '2023-11-14T23:13:20Z', false, true, false, false],
  })
})

test('beeper sign-in - the loopback flow finishes when the browser comes back with the code', async () => {
  const { calls, fetchFn } = beeperFake()
  const signIn = await startBeeperSignIn({ fetchFn, baseUrl: 'http://127.0.0.1:1' })
  const approval = new URL(signIn.url)
  const redirect = new URL(approval.searchParams.get('redirect_uri')!)
  redirect.searchParams.set('code', 'code-9')
  redirect.searchParams.set('state', approval.searchParams.get('state')!)
  const finished = signIn.finish({ timeoutMs: 5000 })
  const page = await fetch(redirect)
  const grant = await finished
  assert({
    given: 'Beeper redirecting the browser to Sky’s loopback address',
    should: 'answer the browser, exchange that code with the verifier, and hand back the grant',
    actual: [
      page.status,
      approval.searchParams.get('client_id'),
      Object.fromEntries(new URLSearchParams(calls.at(-1)!.body)).code,
      grant.token,
    ],
    expected: [200, 'sky-client', 'code-9', 'bpr-abc'],
  })
})
