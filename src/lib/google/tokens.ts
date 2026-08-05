import { createLogin, createSecret, updateEntry } from '#lib/secrets/marshal.ts'
import type { SecretsProvider } from '#lib/secrets/SecretsProvider.ts'
import type { OAuthClient } from './oauth.ts'

/** Keychain category for all Google entries (service `sky-google`). */
export const GOOGLE_SECRETS_CATEGORY = 'google'

/** Reserved entry name for the OAuth client pair; every other name in the category is an account email. */
export const CLIENT_ENTRY_NAME = 'client'

export interface StoredTokens {
  refreshToken: string
  /** Last issued access token, cached as an opaque string; staleness is discovered via 401, never via a clock. */
  accessToken?: string
  scopes: string[]
}

interface TokensWire extends StoredTokens {
  v: 1
}

export async function loadOAuthClient(secrets: SecretsProvider): Promise<OAuthClient | null> {
  const entry = await secrets.get(GOOGLE_SECRETS_CATEGORY, CLIENT_ENTRY_NAME)
  if (!entry || entry.type !== 'login') return null
  return { clientId: entry.user, clientSecret: entry.pass }
}

export async function saveOAuthClient(secrets: SecretsProvider, client: OAuthClient): Promise<void> {
  const existing = await secrets.get(GOOGLE_SECRETS_CATEGORY, CLIENT_ENTRY_NAME)
  const entry =
    existing?.type === 'login'
      ? updateEntry(existing, { user: client.clientId, pass: client.clientSecret })
      : createLogin({ user: client.clientId, pass: client.clientSecret }, 'Google OAuth client (sky google:auth)')
  await secrets.set(GOOGLE_SECRETS_CATEGORY, CLIENT_ENTRY_NAME, entry)
}

export function parseStoredTokens(val: string): StoredTokens | null {
  try {
    const wire = JSON.parse(val) as Partial<TokensWire>
    if (wire.v !== 1 || typeof wire.refreshToken !== 'string') return null
    return {
      refreshToken: wire.refreshToken,
      accessToken: typeof wire.accessToken === 'string' ? wire.accessToken : undefined,
      scopes: Array.isArray(wire.scopes) ? wire.scopes.filter((s) => typeof s === 'string') : [],
    }
  } catch {
    return null
  }
}

export function serializeStoredTokens(tokens: StoredTokens): string {
  const wire: TokensWire = { v: 1, ...tokens }
  return JSON.stringify(wire)
}

export async function loadAccountTokens(secrets: SecretsProvider, email: string): Promise<StoredTokens | null> {
  const entry = await secrets.get(GOOGLE_SECRETS_CATEGORY, email)
  if (!entry || entry.type !== 'secret') return null
  return parseStoredTokens(entry.val)
}

export async function saveAccountTokens(secrets: SecretsProvider, email: string, tokens: StoredTokens): Promise<void> {
  const existing = await secrets.get(GOOGLE_SECRETS_CATEGORY, email)
  const val = serializeStoredTokens(tokens)
  const entry =
    existing?.type === 'secret' ? updateEntry(existing, { val }) : createSecret(val, 'Google account tokens')
  await secrets.set(GOOGLE_SECRETS_CATEGORY, email, entry)
}

export async function deleteAccountTokens(secrets: SecretsProvider, email: string): Promise<void> {
  await secrets.delete(GOOGLE_SECRETS_CATEGORY, email)
}

/** Emails of all stored accounts (the `client` entry is not an account). */
export async function listAccountEmails(secrets: SecretsProvider): Promise<string[]> {
  const entries = await secrets.list(GOOGLE_SECRETS_CATEGORY)
  return entries
    .filter((e) => e.name !== CLIENT_ENTRY_NAME)
    .map((e) => e.name)
    .sort()
}
