import { startLoopback } from '#lib/google/loopback.ts'
import { generatePkce, randomState } from '#lib/google/oauth.ts'
import { Instant, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { NOTION_SIGNED_OUT, NOTION_UNREACHABLE, NotionError } from './errors.ts'

/**
 * Notion's sign-in, for its MCP server: one click for the person. Sky
 * registers itself on the spot as a public client, so there is no secret to
 * keep; the browser shows Notion's own approval page, and the redirect lands
 * on a loopback receiver in this process, the way Google's and Beeper's do.
 * The grant acts as the person, sees what they can see, and carries a
 * refresh token, so it renews itself.
 */

/** Notion's MCP server: the resource every grant is for, and where calls go. */
export const NOTION_MCP_URL = 'https://mcp.notion.com/mcp'

/** Where the server's sign-in describes itself. */
const NOTION_AUTH_METADATA = 'https://mcp.notion.com/.well-known/oauth-authorization-server'

const REQUEST_TIMEOUT_MS = 30_000

export type NotionGrant = {
  accessToken: string
  refreshToken?: string
  /** ISO instant after which Notion refuses the access token */
  expiresAt?: string
  /** The client Sky registered for this sign-in; a renewal names it */
  clientId: string
  /** Where a renewal is asked for */
  tokenEndpoint: string
  /** Where a disconnect hands the grant back, when Notion names a place */
  revocationEndpoint?: string
  /** Who signed in, as Notion names them; read once the sign-in lands */
  workspace?: string
  user?: string
  email?: string
}

export type NotionAuthServer = {
  authorizationEndpoint: string
  tokenEndpoint: string
  registrationEndpoint: string
  revocationEndpoint?: string
}

type Options = { fetchFn?: typeof fetch }

type Answer = { status: number; body: Record<string, unknown> }

const text = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined)

async function call(url: string, init: RequestInit, fetchFn: typeof fetch): Promise<Answer> {
  let response: Response
  try {
    response = await fetchFn(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  } catch {
    throw new NotionError(NOTION_UNREACHABLE, 'unavailable')
  }
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
  return { status: response.status, body }
}

const form = (fields: Record<string, string>): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(fields).toString(),
})

function failed({ status, body }: Answer): NotionError {
  const detail = text(body.error_description) ?? text(body.error) ?? `Notion answered ${status}.`
  return new NotionError(`The Notion sign-in failed: ${detail}`, 'request', status)
}

/** Where Notion's sign-in lives, read from the server's own description. */
export async function discoverNotionAuth(options: Options = {}): Promise<NotionAuthServer> {
  const answer = await call(NOTION_AUTH_METADATA, { method: 'GET' }, options.fetchFn ?? fetch)
  const { body } = answer
  const authorizationEndpoint = text(body.authorization_endpoint)
  const tokenEndpoint = text(body.token_endpoint)
  const registrationEndpoint = text(body.registration_endpoint)
  if (answer.status >= 400) throw failed(answer)
  if (!authorizationEndpoint || !tokenEndpoint || !registrationEndpoint)
    throw new NotionError('The Notion sign-in failed: Notion did not say where to sign in.', 'request')
  const revocationEndpoint = text(body.revocation_endpoint)
  return {
    authorizationEndpoint,
    tokenEndpoint,
    registrationEndpoint,
    ...(revocationEndpoint ? { revocationEndpoint } : {}),
  }
}

/** Register Sky as a public client for one redirect address. Notion answers with the client id. */
export async function registerNotionClient(
  server: NotionAuthServer,
  redirectUri: string,
  options: Options = {},
): Promise<string> {
  const answer = await call(
    server.registrationEndpoint,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Sky',
        redirect_uris: [redirectUri],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      }),
    },
    options.fetchFn ?? fetch,
  )
  if (answer.status >= 400) throw failed(answer)
  const clientId = text(answer.body.client_id)
  if (!clientId) throw new NotionError('The Notion sign-in failed: no client id was issued.', 'request')
  return clientId
}

export function buildNotionAuthUrl(options: {
  server: NotionAuthServer
  clientId: string
  redirectUri: string
  challenge: string
  state: string
}): string {
  const url = new URL(options.server.authorizationEndpoint)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', options.clientId)
  url.searchParams.set('redirect_uri', options.redirectUri)
  url.searchParams.set('state', options.state)
  url.searchParams.set('code_challenge', options.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('resource', NOTION_MCP_URL)
  return url.toString()
}

/** The instant a token issued now for `expiresIn` seconds stops working. */
export function grantExpiry(expiresIn: number, nowMs = new ZonedDateTime().epochMilliseconds): string {
  return Instant.fromEpochMilliseconds(nowMs + Math.max(0, Math.floor(expiresIn)) * 1000).toString()
}

/** Whether the access token has run out, with a minute of slack for clocks and queues. */
export function grantExpired(
  grant: Pick<NotionGrant, 'expiresAt'>,
  nowMs = new ZonedDateTime().epochMilliseconds,
): boolean {
  if (!grant.expiresAt) return false
  try {
    return Instant.from(grant.expiresAt).epochMilliseconds - 60_000 <= nowMs
  } catch {
    return false
  }
}

/** A grant out of a token answer; a renewal that names no new refresh token keeps the old one. */
function grantFrom(
  body: Record<string, unknown>,
  base: Pick<NotionGrant, 'clientId' | 'tokenEndpoint' | 'revocationEndpoint' | 'refreshToken'>,
): NotionGrant {
  const accessToken = text(body.access_token)
  if (!accessToken) throw new NotionError('The Notion sign-in failed: no token was issued.', 'request')
  const refreshToken = text(body.refresh_token) ?? base.refreshToken
  return {
    accessToken,
    ...(refreshToken ? { refreshToken } : {}),
    ...(typeof body.expires_in === 'number' ? { expiresAt: grantExpiry(body.expires_in) } : {}),
    clientId: base.clientId,
    tokenEndpoint: base.tokenEndpoint,
    ...(base.revocationEndpoint ? { revocationEndpoint: base.revocationEndpoint } : {}),
  }
}

export async function exchangeNotionCode(options: {
  server: NotionAuthServer
  clientId: string
  redirectUri: string
  code: string
  verifier: string
  fetchFn?: typeof fetch
}): Promise<NotionGrant> {
  const { server } = options
  const answer = await call(
    server.tokenEndpoint,
    form({
      grant_type: 'authorization_code',
      code: options.code,
      redirect_uri: options.redirectUri,
      client_id: options.clientId,
      code_verifier: options.verifier,
      resource: NOTION_MCP_URL,
    }),
    options.fetchFn ?? fetch,
  )
  if (answer.status >= 400) throw failed(answer)
  return grantFrom(answer.body, {
    clientId: options.clientId,
    tokenEndpoint: server.tokenEndpoint,
    ...(server.revocationEndpoint ? { revocationEndpoint: server.revocationEndpoint } : {}),
  })
}

/** A new access token from the refresh token. A refusal means signing in again. */
export async function refreshNotionGrant(grant: NotionGrant, options: Options = {}): Promise<NotionGrant> {
  if (!grant.refreshToken) throw new NotionError(NOTION_SIGNED_OUT, 'unauthorized')
  const answer = await call(
    grant.tokenEndpoint,
    form({
      grant_type: 'refresh_token',
      refresh_token: grant.refreshToken,
      client_id: grant.clientId,
      resource: NOTION_MCP_URL,
    }),
    options.fetchFn ?? fetch,
  )
  if (answer.status === 400 || answer.status === 401)
    throw new NotionError(NOTION_SIGNED_OUT, 'unauthorized', answer.status)
  if (answer.status >= 400) throw failed(answer)
  const { workspace, user, email } = grant
  return {
    ...grantFrom(answer.body, grant),
    ...(workspace ? { workspace } : {}),
    ...(user ? { user } : {}),
    ...(email ? { email } : {}),
  }
}

/** Hand the grant back to Notion; false when Notion names no place for it or does not confirm. */
export async function revokeNotionGrant(grant: NotionGrant, options: Options = {}): Promise<boolean> {
  if (!grant.revocationEndpoint) return false
  try {
    const answer = await call(
      grant.revocationEndpoint,
      form({
        token: grant.refreshToken ?? grant.accessToken,
        token_type_hint: grant.refreshToken ? 'refresh_token' : 'access_token',
        client_id: grant.clientId,
      }),
      options.fetchFn ?? fetch,
    )
    return answer.status < 400
  } catch {
    return false
  }
}

export type NotionSignIn = {
  /** Notion's approval page, for the browser */
  url: string
  /** Waits for Notion's redirect, then trades the code for a grant */
  finish: (options?: { timeoutMs?: number }) => Promise<NotionGrant>
  close: () => void
}

/** The loopback's failure, in the person's words. */
function refusal(error: unknown): NotionError {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('access_denied'))
    return new NotionError('Sky was not allowed in Notion. Connect again when you are ready.', 'request')
  if (message.startsWith('Timed out'))
    return new NotionError('The Notion sign-in waited too long. Connect again to start over.', 'request')
  return new NotionError(`The Notion sign-in failed: ${message}`, 'request')
}

/**
 * Find Notion's sign-in, open a loopback receiver, register it with Notion,
 * and hand back the approval URL. The caller opens the URL and awaits `finish`.
 */
export async function startNotionSignIn(options: Options = {}): Promise<NotionSignIn> {
  const server = await discoverNotionAuth(options)
  const pkce = await generatePkce()
  const state = randomState()
  const loopback = await startLoopback(state)
  let clientId: string
  try {
    clientId = await registerNotionClient(server, loopback.redirectUri, options)
  } catch (error) {
    loopback.close()
    throw error
  }
  return {
    url: buildNotionAuthUrl({ server, clientId, redirectUri: loopback.redirectUri, challenge: pkce.challenge, state }),
    async finish(wait = {}) {
      try {
        const code = await loopback.waitForCode(wait).catch((error: unknown) => {
          throw refusal(error)
        })
        return await exchangeNotionCode({
          server,
          clientId,
          redirectUri: loopback.redirectUri,
          code,
          verifier: pkce.verifier,
          ...(options.fetchFn ? { fetchFn: options.fetchFn } : {}),
        })
      } finally {
        loopback.close()
      }
    },
    close: () => loopback.close(),
  }
}
