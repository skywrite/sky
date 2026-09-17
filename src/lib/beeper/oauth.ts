import { generatePkce, randomState, startLoopback } from '#lib/google/mod.ts'
import { Instant, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { BEEPER_BASE_URL, BEEPER_NOT_RUNNING, BeeperError, type BeeperClientOptions } from './client.ts'

/**
 * Beeper's sign-in: the installed-app OAuth flow the Google adapter already
 * runs, against the desktop app instead of a cloud. Beeper registers a public
 * client on the spot, shows its own approval screen, and issues a bearer
 * token with an expiry. It issues no refresh token, so an expired grant means
 * signing in again.
 */

export const BEEPER_SCOPES = ['read', 'write']

export type BeeperGrant = {
  token: string
  /** ISO instant after which Beeper refuses the token. Absent for a pasted token of unknown life. */
  expiresAt?: string
  scope?: string
  source: 'oauth' | 'pasted'
}

async function post(
  url: URL,
  init: { headers: Record<string, string>; body: string },
  fetchFn: typeof fetch,
): Promise<Record<string, unknown>> {
  let response: Response
  try {
    response = await fetchFn(url, { method: 'POST', ...init })
  } catch {
    throw new BeeperError(BEEPER_NOT_RUNNING, 'unavailable')
  }
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok) {
    const detail =
      typeof body.error_description === 'string'
        ? body.error_description
        : typeof body.message === 'string'
          ? body.message
          : typeof body.error === 'string'
            ? body.error
            : `Beeper answered ${response.status}.`
    throw new BeeperError(`Beeper sign-in failed: ${detail}`, 'request', response.status)
  }
  return body
}

/** Register Sky as a public client for one redirect address. Beeper answers with the client id. */
export async function registerBeeperClient(redirectUri: string, options: BeeperClientOptions = {}): Promise<string> {
  const body = await post(
    new URL('/oauth/register', options.baseUrl ?? BEEPER_BASE_URL),
    {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Sky',
        redirect_uris: [redirectUri],
        grant_types: ['authorization_code'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        scope: BEEPER_SCOPES.join(' '),
      }),
    },
    options.fetchFn ?? fetch,
  )
  if (typeof body.client_id !== 'string' || !body.client_id)
    throw new BeeperError('Beeper sign-in failed: no client id was issued.', 'request')
  return body.client_id
}

export function buildBeeperAuthUrl(options: {
  baseUrl?: string
  clientId: string
  redirectUri: string
  challenge: string
  state: string
}): string {
  const url = new URL('/oauth/authorize', options.baseUrl ?? BEEPER_BASE_URL)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', options.clientId)
  url.searchParams.set('redirect_uri', options.redirectUri)
  url.searchParams.set('scope', BEEPER_SCOPES.join(' '))
  url.searchParams.set('state', options.state)
  url.searchParams.set('code_challenge', options.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  return url.toString()
}

/** The instant a grant issued now for `expiresIn` seconds stops working. */
export function grantExpiry(expiresIn: number, nowMs = new ZonedDateTime().epochMilliseconds): string {
  return Instant.fromEpochMilliseconds(nowMs + Math.max(0, Math.floor(expiresIn)) * 1000).toString()
}

/** Whether a grant has run out, with a minute of slack for clocks and queues. */
export function grantExpired(grant: BeeperGrant, nowMs = new ZonedDateTime().epochMilliseconds): boolean {
  if (!grant.expiresAt) return false
  try {
    return Instant.from(grant.expiresAt).epochMilliseconds - 60_000 <= nowMs
  } catch {
    return false
  }
}

export async function exchangeBeeperCode(options: {
  baseUrl?: string
  fetchFn?: typeof fetch
  code: string
  verifier: string
  clientId: string
  redirectUri: string
}): Promise<BeeperGrant> {
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code: options.code,
    code_verifier: options.verifier,
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
  })
  const body = await post(
    new URL('/oauth/token', options.baseUrl ?? BEEPER_BASE_URL),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() },
    options.fetchFn ?? fetch,
  )
  if (typeof body.access_token !== 'string' || !body.access_token)
    throw new BeeperError('Beeper sign-in failed: no token was issued.', 'request')
  return {
    token: body.access_token,
    ...(typeof body.expires_in === 'number' ? { expiresAt: grantExpiry(body.expires_in) } : {}),
    ...(typeof body.scope === 'string' ? { scope: body.scope } : {}),
    source: 'oauth',
  }
}

export type BeeperSignIn = {
  /** The approval page, for the browser. */
  url: string
  /** Waits for Beeper's redirect, then trades the code for a grant. */
  finish: (options?: { timeoutMs?: number }) => Promise<BeeperGrant>
  close: () => void
}

/**
 * Open a loopback receiver, register it with Beeper, and hand back the
 * approval URL. The caller opens the URL and awaits `finish`.
 */
export async function startBeeperSignIn(options: BeeperClientOptions = {}): Promise<BeeperSignIn> {
  const pkce = await generatePkce()
  const state = randomState()
  const loopback = await startLoopback(state)
  let clientId: string
  try {
    clientId = await registerBeeperClient(loopback.redirectUri, options)
  } catch (error) {
    loopback.close()
    throw error
  }
  const url = buildBeeperAuthUrl({
    baseUrl: options.baseUrl,
    clientId,
    redirectUri: loopback.redirectUri,
    challenge: pkce.challenge,
    state,
  })
  return {
    url,
    async finish(wait = {}) {
      try {
        const code = await loopback.waitForCode(wait)
        return await exchangeBeeperCode({
          baseUrl: options.baseUrl,
          fetchFn: options.fetchFn,
          code,
          verifier: pkce.verifier,
          clientId,
          redirectUri: loopback.redirectUri,
        })
      } finally {
        loopback.close()
      }
    },
    close: () => loopback.close(),
  }
}
