import type { SecretsProvider } from '#lib/secrets/SecretsProvider.ts'
import { GoogleAuthError, refreshAccessToken } from './oauth.ts'
import type { OAuthClient } from './oauth.ts'
import { loadAccountTokens, saveAccountTokens } from './tokens.ts'
import type { StoredTokens } from './tokens.ts'

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504])
const MAX_ATTEMPTS = 3
/** Per-request ceiling: a silently dead socket must error (and retry), never hang a mission. */
const REQUEST_TIMEOUT_MS = 60_000

// Gmail send endpoints, denied at this chokepoint: sending mail is
// deliberately impossible through this client — drafts are reviewed and sent
// by the user in Gmail. Google has no drafts-without-send OAuth scope
// (modify/compose/full all include send), so the stored grant cannot draw
// this line; the code draws it here, where every Google request passes.
// Removing this guard is its own deliberate, reviewable act — never a side
// effect of adding a feature.
const GMAIL_SEND_PATH = /\/(messages|drafts)\/send$/

/** Throws before a Gmail send URL leaves the machine; every other URL passes. */
export function assertNotGmailSend(url: string): void {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return // not a URL this client could fetch anyway
  }
  if (parsed.hostname === 'gmail.googleapis.com' && GMAIL_SEND_PATH.test(parsed.pathname)) {
    throw new Error(
      `Refusing to call a Gmail send endpoint (${parsed.pathname}) — sending is deliberately unimplemented; drafts are sent by hand from Gmail.`,
    )
  }
}

export class GoogleApiError extends Error {
  readonly status: number
  readonly url: string

  constructor(status: number, url: string, apiMessage?: string) {
    super(`Google API ${status} on ${url}${apiMessage ? `: ${apiMessage}` : ''}`)
    this.name = 'GoogleApiError'
    this.status = status
    this.url = url
  }
}

export interface GoogleClientOptions {
  secrets: SecretsProvider
  email: string
  client: OAuthClient
  fetchFn?: typeof fetch
  /** Backoff sleeper, injectable for tests. */
  sleep?: (ms: number) => Promise<void>
}

/**
 * Authenticated fetch against Google APIs for one account. The last access
 * token is cached in the keychain next to the refresh token and reused as an
 * opaque string — staleness is discovered via a 401 and a single
 * forced-refresh retry, deliberately clock-free.
 */
export class GoogleClient {
  readonly email: string
  private readonly secrets: SecretsProvider
  private readonly client: OAuthClient
  private readonly fetchFn: typeof fetch
  private readonly sleep: (ms: number) => Promise<void>
  private tokens?: StoredTokens

  constructor(options: GoogleClientOptions) {
    this.secrets = options.secrets
    this.email = options.email
    this.client = options.client
    this.fetchFn = options.fetchFn ?? fetch
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  }

  async accessToken(options: { forceRefresh?: boolean } = {}): Promise<string> {
    const tokens = this.tokens ?? (await loadAccountTokens(this.secrets, this.email))
    if (!tokens) {
      throw new GoogleAuthError(`No stored tokens for ${this.email}. Run: sky google:auth`)
    }
    this.tokens = tokens
    if (tokens.accessToken && !options.forceRefresh) return tokens.accessToken

    let response
    try {
      response = await refreshAccessToken({
        client: this.client,
        refreshToken: tokens.refreshToken,
        fetchFn: this.fetchFn,
      })
    } catch (err) {
      if (err instanceof GoogleAuthError && err.code === 'invalid_grant') {
        throw new GoogleAuthError(
          `Google rejected the stored grant for ${this.email} (revoked or expired). Run: sky google:auth`,
          err.code,
        )
      }
      throw err
    }
    const updated: StoredTokens = {
      ...tokens,
      accessToken: response.access_token,
      // Google may rotate the refresh token; keep the newest one
      refreshToken: response.refresh_token ?? tokens.refreshToken,
    }
    this.tokens = updated
    await saveAccountTokens(this.secrets, this.email, updated)
    return response.access_token
  }

  /** Authenticated fetch with one forced-refresh retry on 401 and backoff on transient errors. */
  async request(url: string, init: RequestInit = {}): Promise<Response> {
    assertNotGmailSend(url)
    let token = await this.accessToken()
    for (let attempt = 1; ; attempt++) {
      let res: Response
      try {
        res = await this.fetchFn(url, {
          ...init,
          signal: init.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` },
        })
      } catch (err) {
        // Timeouts and dropped connections are the same transient class as a 5xx.
        if (attempt < MAX_ATTEMPTS) {
          await this.sleep(500 * attempt)
          continue
        }
        throw new Error(
          `Google API request failed after ${MAX_ATTEMPTS} attempts on ${url}: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
      if (res.ok) return res
      if (res.status === 401 && attempt === 1) {
        token = await this.accessToken({ forceRefresh: true })
        continue
      }
      if (RETRYABLE_STATUS.has(res.status) && attempt < MAX_ATTEMPTS) {
        await this.sleep(500 * attempt)
        continue
      }
      throw new GoogleApiError(res.status, url, await readApiError(res))
    }
  }

  async getJson<T>(url: string): Promise<T> {
    const res = await this.request(url)
    return (await res.json()) as T
  }

  async postJson<T>(url: string, body: unknown): Promise<T> {
    const res = await this.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return (await res.json()) as T
  }

  async putJson<T>(url: string, body: unknown): Promise<T> {
    const res = await this.request(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return (await res.json()) as T
  }

  async getText(url: string): Promise<string> {
    const res = await this.request(url)
    return await res.text()
  }

  async getBytes(url: string): Promise<Uint8Array> {
    const res = await this.request(url)
    return new Uint8Array(await res.arrayBuffer())
  }
}

async function readApiError(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.json()) as { error?: { message?: string } }
    return body.error?.message
  } catch {
    return undefined
  }
}
