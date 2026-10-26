import { assert, test } from '#test'
import { NOTION_SIGNED_OUT, NotionError } from './errors.ts'
import {
  grantExpired,
  grantExpiry,
  NOTION_MCP_URL,
  type NotionGrant,
  refreshNotionGrant,
  revokeNotionGrant,
  startNotionSignIn,
} from './oauth.ts'

type Call = { url: string; method: string; body: string; type: string }

const METADATA = {
  issuer: 'https://mcp.example.com',
  authorization_endpoint: 'https://mcp.example.com/authorize',
  token_endpoint: 'https://mcp.example.com/token',
  registration_endpoint: 'https://mcp.example.com/register',
  revocation_endpoint: 'https://mcp.example.com/revoke',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function notionFake(answers: { register?: Response; token?: Response; revoke?: Response } = {}) {
  const calls: Call[] = []
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? init.body : '',
      type: new Headers(init?.headers).get('content-type') ?? '',
    })
    if (url.endsWith('/.well-known/oauth-authorization-server')) return json(METADATA)
    if (url === METADATA.registration_endpoint) return answers.register ?? json({ client_id: 'sky-client' }, 201)
    if (url === METADATA.token_endpoint)
      return (
        answers.token ?? json({ access_token: 'at-1', refresh_token: 'rt-1', token_type: 'bearer', expires_in: 3600 })
      )
    if (url === METADATA.revocation_endpoint) return answers.revoke ?? new Response(null, { status: 200 })
    return json({}, 404)
  }) as unknown as typeof fetch
  return { calls, fetchFn }
}

const formOf = (call: Call | undefined) => Object.fromEntries(new URLSearchParams(call?.body ?? ''))

const grant = (changes: Partial<NotionGrant> = {}): NotionGrant => ({
  accessToken: 'at-old',
  refreshToken: 'rt-old',
  clientId: 'sky-client',
  tokenEndpoint: METADATA.token_endpoint,
  revocationEndpoint: METADATA.revocation_endpoint,
  workspace: 'Atlas',
  user: 'Jane Doe',
  email: 'jane@example.com',
  ...changes,
})

test('notion sign-in - registers a public client, asks for the MCP server with S256, and trades the code for a grant', async () => {
  const { calls, fetchFn } = notionFake()
  const signIn = await startNotionSignIn({ fetchFn })
  const approval = new URL(signIn.url)
  const registered = JSON.parse(calls.find((call) => call.url === METADATA.registration_endpoint)!.body)
  const redirect = new URL(approval.searchParams.get('redirect_uri')!)
  redirect.searchParams.set('code', 'code-9')
  redirect.searchParams.set('state', approval.searchParams.get('state')!)
  const finished = signIn.finish({ timeoutMs: 5000 })
  const page = await fetch(redirect)
  const signedIn = await finished
  const exchange = calls.find((call) => call.url === METADATA.token_endpoint)
  assert({
    given: 'Notion approving Sky and redirecting the browser to the loopback address',
    should:
      'register without a secret, send the resource and the PKCE challenge, and exchange the code with the verifier',
    actual: {
      registered: {
        name: registered.client_name,
        auth: registered.token_endpoint_auth_method,
        grants: registered.grant_types,
        redirect: registered.redirect_uris[0] === approval.searchParams.get('redirect_uri'),
      },
      approval: {
        at: `${approval.origin}${approval.pathname}`,
        client: approval.searchParams.get('client_id'),
        method: approval.searchParams.get('code_challenge_method'),
        resource: approval.searchParams.get('resource'),
        loopback: redirect.hostname,
      },
      page: page.status,
      exchange: {
        type: exchange?.type,
        grant: formOf(exchange).grant_type,
        code: formOf(exchange).code,
        verifier: Boolean(formOf(exchange).code_verifier),
        resource: formOf(exchange).resource,
      },
      grant: [signedIn.accessToken, signedIn.refreshToken, signedIn.clientId, signedIn.revocationEndpoint],
      expires: grantExpired(signedIn),
    },
    expected: {
      registered: { name: 'Sky', auth: 'none', grants: ['authorization_code', 'refresh_token'], redirect: true },
      approval: {
        at: METADATA.authorization_endpoint,
        client: 'sky-client',
        method: 'S256',
        resource: NOTION_MCP_URL,
        loopback: '127.0.0.1',
      },
      page: 200,
      exchange: {
        type: 'application/x-www-form-urlencoded',
        grant: 'authorization_code',
        code: 'code-9',
        verifier: true,
        resource: NOTION_MCP_URL,
      },
      grant: ['at-1', 'rt-1', 'sky-client', METADATA.revocation_endpoint],
      expires: false,
    },
  })
})

test('notion sign-in - a person who does not allow Sky is told so in plain words', async () => {
  const { fetchFn } = notionFake()
  const signIn = await startNotionSignIn({ fetchFn })
  const approval = new URL(signIn.url)
  const redirect = new URL(approval.searchParams.get('redirect_uri')!)
  redirect.searchParams.set('error', 'access_denied')
  const finished = signIn.finish({ timeoutMs: 5000 }).catch((error: unknown) => error)
  await fetch(redirect)
  const error = await finished
  assert({
    given: 'Notion redirecting back with access_denied',
    should: 'fail the sign-in with a sentence the page can show',
    actual: error instanceof NotionError ? error.message : String(error),
    expected: 'Sky was not allowed in Notion. Connect again when you are ready.',
  })
})

test('notion sign-in - a refused registration names Notion’s reason', async () => {
  const { fetchFn } = notionFake({
    register: json({ error: 'invalid_redirect_uri', error_description: 'Redirect not allowed' }, 400),
  })
  const error = await startNotionSignIn({ fetchFn }).catch((failure: unknown) => failure)
  assert({
    given: 'a registration Notion refuses',
    should: 'say what Notion said',
    actual: error instanceof NotionError ? [error.kind, error.message] : String(error),
    expected: ['request', 'The Notion sign-in failed: Redirect not allowed'],
  })
})

test('notion grant - a renewal keeps the refresh token Notion did not replace, and who signed in', async () => {
  const { calls, fetchFn } = notionFake({ token: json({ access_token: 'at-2', expires_in: 3600 }) })
  const renewed = await refreshNotionGrant(grant({ expiresAt: '2026-01-01T00:00:00Z' }), { fetchFn })
  assert({
    given: 'a token answer without a new refresh token',
    should: 'ask with the refresh token and the resource, keep the old refresh token, and carry the names over',
    actual: {
      form: formOf(calls[0]),
      grant: [renewed.accessToken, renewed.refreshToken, renewed.workspace, renewed.user, renewed.email],
      expired: grantExpired(renewed),
    },
    expected: {
      form: {
        grant_type: 'refresh_token',
        refresh_token: 'rt-old',
        client_id: 'sky-client',
        resource: NOTION_MCP_URL,
      },
      grant: ['at-2', 'rt-old', 'Atlas', 'Jane Doe', 'jane@example.com'],
      expired: false,
    },
  })
})

test('notion grant - a refused renewal, or none to ask with, means signing in again', async () => {
  const { calls, fetchFn } = notionFake({ token: json({ error: 'invalid_grant' }, 400) })
  const refused = await refreshNotionGrant(grant(), { fetchFn }).catch((error: unknown) => error)
  const missing = await refreshNotionGrant(grant({ refreshToken: undefined }), { fetchFn }).catch(
    (error: unknown) => error,
  )
  assert({
    given: 'an invalid_grant answer, then a grant without a refresh token',
    should: 'fail both as signed out, and ask Notion only once',
    actual: [
      refused instanceof NotionError ? [refused.kind, refused.message] : String(refused),
      missing instanceof NotionError ? [missing.kind, missing.message] : String(missing),
      calls.length,
    ],
    expected: [['unauthorized', NOTION_SIGNED_OUT], ['unauthorized', NOTION_SIGNED_OUT], 1],
  })
})

test('notion grant - expiry has a minute of slack, and a disconnect hands the refresh token back', async () => {
  const now = 1_800_000_000_000
  const { calls, fetchFn } = notionFake()
  const revoked = await revokeNotionGrant(grant(), { fetchFn })
  const nowhere = await revokeNotionGrant(grant({ revocationEndpoint: undefined }), { fetchFn })
  assert({
    given: 'grants issued for an hour and for thirty seconds, and two disconnects',
    should: 'treat the short one as run out, and revoke only where Notion names a place',
    actual: {
      hour: grantExpired({ expiresAt: grantExpiry(3600, now) }, now),
      seconds: grantExpired({ expiresAt: grantExpiry(30, now) }, now),
      revoked,
      nowhere,
      form: formOf(calls[0]),
      asked: calls.length,
    },
    expected: {
      hour: false,
      seconds: true,
      revoked: true,
      nowhere: false,
      form: { token: 'rt-old', token_type_hint: 'refresh_token', client_id: 'sky-client' },
      asked: 1,
    },
  })
})
