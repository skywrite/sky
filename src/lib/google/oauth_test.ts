import { assert, test } from '#test'
import { GoogleAuthError, buildAuthUrl, exchangeCode, generatePkce, refreshAccessToken } from './oauth.ts'

const CLIENT = { clientId: 'test-client-id', clientSecret: 'test-client-secret' }

test('generatePkce', async () => {
  const bytes = new Uint8Array(32).fill(7)
  const first = await generatePkce(bytes)
  const second = await generatePkce(bytes)

  assert({
    given: 'the same random bytes',
    should: 'derive the same verifier and challenge',
    expected: first,
    actual: second,
  })

  assert({
    given: 'a pkce pair',
    should: 'be base64url with no padding',
    expected: true,
    actual: /^[A-Za-z0-9_-]+$/.test(first.verifier) && /^[A-Za-z0-9_-]+$/.test(first.challenge),
  })

  assert({
    given: 'a 32-byte verifier source',
    should: 'meet the RFC 7636 minimum length of 43 chars',
    expected: true,
    actual: first.verifier.length >= 43,
  })

  assert({
    given: 'a verifier',
    should: 'not equal its own challenge (challenge is a digest)',
    expected: false,
    actual: first.verifier === first.challenge,
  })
})

test('buildAuthUrl', () => {
  const url = new URL(
    buildAuthUrl({
      clientId: CLIENT.clientId,
      redirectUri: 'http://127.0.0.1:7777/oauth/callback',
      challenge: 'the-challenge',
      state: 'the-state',
    }),
  )

  assert({
    given: 'an auth url',
    should: 'point at the Google authorization endpoint',
    expected: 'accounts.google.com',
    actual: url.hostname,
  })

  const params = url.searchParams
  assert({
    given: 'an auth url',
    should: 'carry the installed-app flow parameters',
    expected: ['test-client-id', 'code', 'the-challenge', 'S256', 'the-state', 'offline', 'consent'],
    actual: [
      params.get('client_id'),
      params.get('response_type'),
      params.get('code_challenge'),
      params.get('code_challenge_method'),
      params.get('state'),
      params.get('access_type'),
      params.get('prompt'),
    ],
  })

  assert({
    given: 'the default scopes',
    should: 'include Drive and the email identity scope',
    expected: true,
    actual:
      (params.get('scope') ?? '').includes('https://www.googleapis.com/auth/drive') &&
      (params.get('scope') ?? '').includes('email'),
  })
})

test('exchangeCode', async () => {
  let captured: { url: string; body: string } | undefined
  const fetchFn = (async (url: unknown, init?: RequestInit) => {
    captured = { url: String(url), body: String(init?.body) }
    return new Response(JSON.stringify({ access_token: 'at-1', expires_in: 3600, refresh_token: 'rt-1' }), {
      status: 200,
    })
  }) as typeof fetch

  const tokens = await exchangeCode({
    client: CLIENT,
    code: 'auth-code',
    verifier: 'the-verifier',
    redirectUri: 'http://127.0.0.1:7777/oauth/callback',
    fetchFn,
  })

  const body = new URLSearchParams(captured?.body ?? '')
  assert({
    given: 'a code exchange',
    should: 'POST the authorization_code grant with PKCE verifier',
    expected: ['authorization_code', 'auth-code', 'the-verifier', 'test-client-id', 'test-client-secret'],
    actual: [
      body.get('grant_type'),
      body.get('code'),
      body.get('code_verifier'),
      body.get('client_id'),
      body.get('client_secret'),
    ],
  })

  assert({
    given: 'a successful exchange',
    should: 'return the parsed token response',
    expected: ['at-1', 'rt-1'],
    actual: [tokens.access_token, tokens.refresh_token],
  })
})

test('refreshAccessToken failure', async () => {
  const fetchFn = (async () =>
    new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Token has been revoked.' }), {
      status: 400,
    })) as unknown as typeof fetch

  let caught: unknown
  try {
    await refreshAccessToken({ client: CLIENT, refreshToken: 'rt-x', fetchFn })
  } catch (err) {
    caught = err
  }

  assert({
    given: 'a 400 with invalid_grant',
    should: 'throw GoogleAuthError carrying the error code',
    expected: ['GoogleAuthError', 'invalid_grant'],
    actual: [caught instanceof GoogleAuthError ? caught.name : 'no-throw', (caught as GoogleAuthError)?.code],
  })
})
