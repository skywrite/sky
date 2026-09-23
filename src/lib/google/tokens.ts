import { createLogin, createSecret, updateEntry } from '#lib/secrets/marshal.ts'
import type { SecretsProvider } from '#lib/secrets/SecretsProvider.ts'
import type { OAuthClient } from './oauth.ts'

/** Keychain category for all Google entries (service `sky-google`). */
export const GOOGLE_SECRETS_CATEGORY = 'google'

/** Reserved entry name for the shared OAuth client pair; every other non-client name in the category is an account email. */
export const CLIENT_ENTRY_NAME = 'client'

/**
 * A client pair Sky made itself lives under `client:<projectId>` — one per
 * Google Cloud project it set up — beside the shared, hand-pasted `client`.
 * Which pair refreshes an account is written on the account's tokens.
 */
export function projectClientEntryName(projectId: string): string {
  return `${CLIENT_ENTRY_NAME}:${projectId}`
}

/** Is this entry a client pair (shared or per project), rather than an account? */
export function isClientEntryName(name: string): boolean {
  return name === CLIENT_ENTRY_NAME || name.startsWith(`${CLIENT_ENTRY_NAME}:`)
}

export interface StoredTokens {
  refreshToken: string
  /** Last issued access token, cached as an opaque string; staleness is discovered via 401, never via a clock. */
  accessToken?: string
  scopes: string[]
  /** The client entry that issued this grant; absent means the shared `client`. */
  client?: string
  /** Set when Sky made the Google Cloud side itself: which project, and when. */
  setup?: { projectId: string; at: string }
}

interface TokensWire extends StoredTokens {
  v: 1
}

async function loadClientEntry(secrets: SecretsProvider, name: string): Promise<OAuthClient | null> {
  const entry = await secrets.get(GOOGLE_SECRETS_CATEGORY, name)
  if (!entry || entry.type !== 'login') return null
  return { clientId: entry.user, clientSecret: entry.pass }
}

async function saveClientEntry(
  secrets: SecretsProvider,
  name: string,
  client: OAuthClient,
  notes: string,
): Promise<void> {
  const existing = await secrets.get(GOOGLE_SECRETS_CATEGORY, name)
  const entry =
    existing?.type === 'login'
      ? updateEntry(existing, { user: client.clientId, pass: client.clientSecret })
      : createLogin({ user: client.clientId, pass: client.clientSecret }, notes)
  await secrets.set(GOOGLE_SECRETS_CATEGORY, name, entry)
}

/** The shared, hand-pasted client pair. */
export function loadOAuthClient(secrets: SecretsProvider): Promise<OAuthClient | null> {
  return loadClientEntry(secrets, CLIENT_ENTRY_NAME)
}

export function saveOAuthClient(secrets: SecretsProvider, client: OAuthClient): Promise<void> {
  return saveClientEntry(secrets, CLIENT_ENTRY_NAME, client, 'Google OAuth client (sky google:auth)')
}

/** The pair Sky made in a project of its own, stored the moment Google shows it — Google shows a secret once. */
export function saveProjectClient(secrets: SecretsProvider, projectId: string, client: OAuthClient): Promise<void> {
  return saveClientEntry(
    secrets,
    projectClientEntryName(projectId),
    client,
    `Google OAuth client made by sky in project ${projectId}`,
  )
}

export function loadProjectClient(secrets: SecretsProvider, projectId: string): Promise<OAuthClient | null> {
  return loadClientEntry(secrets, projectClientEntryName(projectId))
}

/** Is any client pair stored — shared or made by Sky? */
export async function hasAnyOAuthClient(secrets: SecretsProvider): Promise<boolean> {
  const entries = await secrets.list(GOOGLE_SECRETS_CATEGORY)
  return entries.some((e) => isClientEntryName(e.name))
}

/**
 * The pair a plain sign-in uses for an account that has no grant yet: the
 * shared `client` when stored, else the first pair Sky made — any Google
 * account may grant to those. Null when there is none.
 */
export async function loadDefaultClient(
  secrets: SecretsProvider,
): Promise<{ name: string; client: OAuthClient } | null> {
  const shared = await loadOAuthClient(secrets)
  if (shared) return { name: CLIENT_ENTRY_NAME, client: shared }
  const entries = await secrets.list(GOOGLE_SECRETS_CATEGORY)
  const names = entries
    .map((e) => e.name)
    .filter((name) => isClientEntryName(name) && name !== CLIENT_ENTRY_NAME)
    .sort()
  for (const name of names) {
    const client = await loadClientEntry(secrets, name)
    if (client) return { name, client }
  }
  return null
}

/**
 * The pair that refreshes this account: the one its grant names, else the
 * shared `client`. Null when the account has neither — a stored account whose
 * client entry was removed.
 */
export async function loadAccountClient(secrets: SecretsProvider, email: string): Promise<OAuthClient | null> {
  const tokens = await loadAccountTokens(secrets, email)
  return loadClientEntry(secrets, tokens?.client ?? CLIENT_ENTRY_NAME)
}

export function parseStoredTokens(val: string): StoredTokens | null {
  try {
    const wire = JSON.parse(val) as Partial<TokensWire>
    if (wire.v !== 1 || typeof wire.refreshToken !== 'string') return null
    const setup =
      wire.setup && typeof wire.setup.projectId === 'string' && typeof wire.setup.at === 'string'
        ? { projectId: wire.setup.projectId, at: wire.setup.at }
        : undefined
    return {
      refreshToken: wire.refreshToken,
      accessToken: typeof wire.accessToken === 'string' ? wire.accessToken : undefined,
      scopes: Array.isArray(wire.scopes) ? wire.scopes.filter((s) => typeof s === 'string') : [],
      ...(typeof wire.client === 'string' ? { client: wire.client } : {}),
      ...(setup ? { setup } : {}),
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

/** Emails of all stored accounts (the client entries are not accounts). */
export async function listAccountEmails(secrets: SecretsProvider): Promise<string[]> {
  const entries = await secrets.list(GOOGLE_SECRETS_CATEGORY)
  return entries
    .filter((e) => !isClientEntryName(e.name))
    .map((e) => e.name)
    .sort()
}
