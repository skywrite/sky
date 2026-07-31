import type { SecretsProvider } from '#lib/secrets/SecretsProvider.ts'
import { GoogleAuthError, refreshAccessToken } from './oauth.ts'
import type { OAuthClient } from './oauth.ts'
import { loadAccountTokens, saveAccountTokens } from './tokens.ts'
import type { StoredTokens } from './tokens.ts'

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504])
const MAX_ATTEMPTS = 3

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
    let token = await this.accessToken()
    for (let attempt = 1; ; attempt++) {
      const res = await this.fetchFn(url, {
        ...init,
        headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` },
      })
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
