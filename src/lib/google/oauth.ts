import { Buffer } from 'node:buffer'

// Google OAuth 2.0 endpoints for installed (desktop) apps.
export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'

// Workspace scopes for the docs/sheets/slides feature. The identity scopes let
// auth learn which account granted access so tokens can be stored per email.
export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/presentations',
]

/** BYO OAuth client pair. Google treats installed-app secrets as non-confidential, ours still lives in the keychain. */
export interface OAuthClient {
  clientId: string
  clientSecret: string
}

export interface TokenResponse {
  access_token: string
  expires_in: number
  refresh_token?: string
  scope?: string
  token_type?: string
  id_token?: string
}

export class GoogleAuthError extends Error {
  readonly code?: string

  constructor(message: string, code?: string) {
    super(message)
    this.name = 'GoogleAuthError'
    this.code = code
  }
}

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url')
}

export interface PkcePair {
  verifier: string
  challenge: string
}

/** RFC 7636 PKCE pair. `randomBytes` is injectable for deterministic tests. */
export async function generatePkce(randomBytes?: Uint8Array): Promise<PkcePair> {
  const bytes = randomBytes ?? crypto.getRandomValues(new Uint8Array(32))
  const verifier = base64Url(bytes)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return { verifier, challenge: base64Url(new Uint8Array(digest)) }
}

export function randomState(randomBytes?: Uint8Array): string {
  return base64Url(randomBytes ?? crypto.getRandomValues(new Uint8Array(16)))
}

export function buildAuthUrl(options: {
  clientId: string
  redirectUri: string
  challenge: string
  state: string
  scopes?: string[]
}): string {
  const url = new URL(GOOGLE_AUTH_URL)
  url.searchParams.set('client_id', options.clientId)
  url.searchParams.set('redirect_uri', options.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', (options.scopes ?? GOOGLE_SCOPES).join(' '))
  url.searchParams.set('code_challenge', options.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', options.state)
  // offline + consent: Google only issues a refresh token on a consenting grant
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  return url.toString()
}

/** Auth endpoints answer in seconds; a hang here would freeze every request behind the token refresh. */
const AUTH_TIMEOUT_MS = 30_000

async function postTokenEndpoint(params: Record<string, string>, fetchFn: typeof fetch): Promise<TokenResponse> {
  const res = await fetchFn(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
  })
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    const code = typeof body.error === 'string' ? body.error : undefined
    const description = typeof body.error_description === 'string' ? body.error_description : ''
    const message = `Google token endpoint ${res.status}: ${code ?? 'unknown_error'} ${description}`.trim()
    throw new GoogleAuthError(message, code)
  }
  return body as unknown as TokenResponse
}

export function exchangeCode(options: {
  client: OAuthClient
  code: string
  verifier: string
  redirectUri: string
  fetchFn?: typeof fetch
}): Promise<TokenResponse> {
  return postTokenEndpoint(
    {
      client_id: options.client.clientId,
      client_secret: options.client.clientSecret,
      code: options.code,
      code_verifier: options.verifier,
      grant_type: 'authorization_code',
      redirect_uri: options.redirectUri,
    },
    options.fetchFn ?? fetch,
  )
}

export function refreshAccessToken(options: {
  client: OAuthClient
  refreshToken: string
  fetchFn?: typeof fetch
}): Promise<TokenResponse> {
  return postTokenEndpoint(
    {
      client_id: options.client.clientId,
      client_secret: options.client.clientSecret,
      refresh_token: options.refreshToken,
      grant_type: 'refresh_token',
    },
    options.fetchFn ?? fetch,
  )
}

/** The email of the account that granted the token (requires the `email` scope). */
export async function fetchAccountEmail(accessToken: string, fetchFn: typeof fetch = fetch): Promise<string> {
  const res = await fetchFn(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
  })
  if (!res.ok) throw new GoogleAuthError(`Google userinfo endpoint ${res.status}`)
  const body = (await res.json()) as { email?: string }
  if (!body.email) throw new GoogleAuthError('Google userinfo response had no email')
  return body.email
}
