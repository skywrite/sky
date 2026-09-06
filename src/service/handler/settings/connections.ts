/**
 * Connections — the accounts and keys Sky signs in with, over the keychain.
 *
 * Everything the page is told is presence: which entries exist, of what
 * type, for whom. A value never leaves the keychain through these routes —
 * it goes in, and only its name comes back, plus a key's last few
 * characters so two keys can be told apart. The Google entries sit under
 * Accounts; every other entry is one list, complete, so this page is
 * `sky secrets:list`, `secrets:set` and `secrets:delete` for the same store.
 *
 * Slack's credentials are agent-slack's: the page reports its test and can
 * re-import them from Brave, the way `sky slack:auth` does.
 */

import { Hono } from 'hono'
import {
  CLIENT_ENTRY_NAME,
  GOOGLE_CLOUD_SETUP_STEPS,
  GOOGLE_SECRETS_CATEGORY,
  listAccountEmails,
  loadAccountTokens,
  saveOAuthClient,
  type StoredTokens,
} from '#lib/google/mod.ts'
import { createLogin, createSecret, updateEntry } from '#lib/secrets/marshal.ts'
import type { SecretsProvider } from '#lib/secrets/SecretsProvider.ts'
import type { EntityType, IndexEntry, SecretEntry } from '#lib/secrets/types.ts'
import { secretFieldError, type SecretField } from './secretValidation.ts'

export { SECRET_CATEGORY, SECRET_NAME } from './secretValidation.ts'

// ── What the page is told ───────────────────────────────────────────

export interface GoogleAccountRow {
  email: string
  /** What the grant covers: Mail, Calendar, Drive, Docs */
  grants: string[]
}

/** One keychain entry — its name and type, never its value. */
export interface SecretRow {
  category: string
  name: string
  type: EntityType
  /** In plain words: "Cerebras API key", or the category, or category · name */
  label: string
  /** The kind, and what tells two entries apart — a login's username */
  sub: string
  /** A key's last four characters, when it is long enough that they give nothing away */
  tail?: string
}

export interface ConnectionsData {
  google: {
    /** The OAuth client pair is stored — a sign-in can start */
    client: boolean
    accounts: GoogleAccountRow[]
    /** The one-time Google Cloud steps, for the client form */
    setup: string[]
  }
  /** Every keychain entry but the Google ones, by category then name */
  secrets: SecretRow[]
}

export type SlackStatus =
  | { installed: false }
  | { installed: true; ok: true; workspace: string | null; team: string | null; user: string | null }
  | { installed: true; ok: false; error: string }

/** How a Google sign-in started from the page is going. */
export type GoogleConnectState =
  | { status: 'waiting' }
  | { status: 'done'; email: string }
  | { status: 'failed'; message: string }

/** The host behind the routes — production is the keychain and the machine, tests script it. */
export interface ConnectionsHost {
  /** The keychain — in tests, a store in memory */
  secrets: SecretsProvider
  /** The model providers, by id and in plain words — a key stored under one is named after it */
  providers: () => Array<{ id: string; label: string }>
  google: {
    /** Starts a sign-in: the URL for the browser and an id to ask after; null when no client is stored */
    connect: () => Promise<{ id: string; url: string } | null>
    /** How a sign-in is going; null for an id this process never issued */
    connection: (id: string) => GoogleConnectState | null
  }
  slack: {
    status: () => Promise<SlackStatus>
    /** A Brave re-import, then the test again */
    reconnect: () => Promise<SlackStatus>
  }
}

/**
 * The store is category and name; a category with one entry — a provider's
 * key — has nothing to name, and the terminal fills the slot with this. It
 * is filled in for a blank name and never printed.
 */
export const KEY_ENTRY_NAME = 'main'

// ── Presence, never values ──────────────────────────────────────────

/** A scope's plain word; scopes that mean nothing to a person are left out. */
const GRANTS: ReadonlyArray<[match: string | RegExp, label: string]> = [
  ['/auth/gmail', 'Mail'],
  ['/auth/calendar', 'Calendar'],
  ['/auth/drive', 'Drive'],
  [/\/auth\/(documents|spreadsheets|presentations)/, 'Docs'],
]

export function grantsOf(tokens: StoredTokens | null): string[] {
  if (!tokens) return []
  return GRANTS.filter(([match]) =>
    tokens.scopes.some((scope) => (typeof match === 'string' ? scope.includes(match) : match.test(scope))),
  ).map(([, label]) => label)
}

/** Shorter than this, four characters would give a secret away. */
const TAIL_MIN = 12

/** The last four characters of a key, or nothing when the key is short. */
export function tailOf(value: string): string | undefined {
  return value.length >= TAIL_MIN ? value.slice(-4) : undefined
}

/**
 * One entry as the page reads it. A provider's key is named after the
 * provider; the filler name is never printed; a login shows its username;
 * a key shows its tail — only when the index and the entry agree it is one.
 */
export function secretRow(index: IndexEntry, entry: SecretEntry | null, providers: Map<string, string>): SecretRow {
  const bare = index.name === KEY_ENTRY_NAME
  const provider = bare ? providers.get(index.category) : undefined
  const label = provider ? `${provider} API key` : bare ? index.category : `${index.category} · ${index.name}`
  const user = entry?.type === 'login' ? entry.user : undefined
  const sub = index.type === 'login' ? (user ? `Login · ${user}` : 'Login') : provider ? '' : 'Secret'
  const tail = index.type === 'secret' && entry?.type === 'secret' ? tailOf(entry.val) : undefined
  return { category: index.category, name: index.name, type: index.type, label, sub, ...(tail ? { tail } : {}) }
}

export async function describeConnections(host: ConnectionsHost): Promise<ConnectionsData> {
  const { secrets } = host
  const index = await secrets.list()
  const has = (category: string, name: string) => index.some((e) => e.category === category && e.name === name)

  const accounts = await Promise.all(
    (await listAccountEmails(secrets)).map(async (email) => ({
      email,
      grants: grantsOf(await loadAccountTokens(secrets, email).catch(() => null)),
    })),
  )

  const providers = new Map(host.providers().map((provider) => [provider.id, provider.label]))
  const rest = index
    .filter((e) => e.category !== GOOGLE_SECRETS_CATEGORY)
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
  const rows = await Promise.all(
    rest.map(async (e) => secretRow(e, await secrets.get(e.category, e.name).catch(() => null), providers)),
  )

  return {
    google: { client: has(GOOGLE_SECRETS_CATEGORY, CLIENT_ENTRY_NAME), accounts, setup: [...GOOGLE_CLOUD_SETUP_STEPS] },
    secrets: rows,
  }
}

// ── Writes ──────────────────────────────────────────────────────────

export type SecretInput =
  | { category: string; name: string; type: 'secret'; value: string }
  | { category: string; name: string; type: 'login'; user: string; pass: string }

export interface SecretInputError {
  field: SecretField | 'type'
  message: string
}

/** A rejected value names its field, so the form can highlight it. A blank name is the filler. */
export function readSecretInput(body: unknown): SecretInput | SecretInputError {
  const b = (body ?? {}) as Record<string, unknown>
  const category = typeof b.category === 'string' ? b.category.trim() : ''
  const name = typeof b.name === 'string' && b.name.trim() ? b.name.trim() : KEY_ENTRY_NAME
  for (const [field, value] of [
    ['category', category],
    ['name', name],
  ] as const) {
    const message = secretFieldError(field, value)
    if (message) return { field, message }
  }
  if (b.type === 'secret') {
    const value = typeof b.value === 'string' ? b.value.trim() : ''
    const message = secretFieldError('value', value)
    if (message) return { field: 'value', message }
    return { category, name, type: 'secret', value }
  }
  if (b.type === 'login') {
    const user = typeof b.user === 'string' ? b.user.trim() : ''
    const pass = typeof b.pass === 'string' ? b.pass : ''
    for (const [field, value] of [
      ['user', user],
      ['pass', pass],
    ] as const) {
      const message = secretFieldError(field, value)
      if (message) return { field, message }
    }
    return { category, name, type: 'login', user, pass }
  }
  return { field: 'type', message: 'Choose key or token, or login.' }
}

/** The entry to store: same type as before keeps the entry's history; a new type starts fresh. */
export function entryFor(input: SecretInput, existing: SecretEntry | null): SecretEntry {
  if (input.type === 'secret') {
    return existing?.type === 'secret' ? updateEntry(existing, { val: input.value }) : createSecret(input.value)
  }
  return existing?.type === 'login'
    ? updateEntry(existing, { user: input.user, pass: input.pass })
    : createLogin({ user: input.user, pass: input.pass })
}

const message = (err: unknown) => ({ message: err instanceof Error ? err.message : String(err) })

export function createConnectionsRoutes(host: ConnectionsHost): Hono {
  const app = new Hono()

  // Everything the page shows — presence, never a value.
  app.get('/', async (c) => {
    try {
      return c.json(await describeConnections(host))
    } catch (err) {
      return c.json(message(err), 500)
    }
  })

  // Slack: agent-slack's own test, and a Brave re-import when it fails.
  app.get('/slack', async (c) => {
    try {
      return c.json(await host.slack.status())
    } catch (err) {
      return c.json(message(err), 500)
    }
  })
  app.post('/slack/reconnect', async (c) => {
    try {
      return c.json(await host.slack.reconnect())
    } catch (err) {
      return c.json(message(err), 500)
    }
  })

  // One entry into the keychain — a key, a token, a login.
  app.post('/secret', async (c) => {
    const input = readSecretInput(await c.req.json().catch(() => null))
    if ('field' in input) return c.json(input, 400)
    try {
      const existing = await host.secrets.get(input.category, input.name)
      await host.secrets.set(input.category, input.name, entryFor(input, existing))
      return c.json({ ok: true })
    } catch (err) {
      return c.json(message(err), 500)
    }
  })

  // One entry out. An unknown name is a 404, not a silent no-op.
  app.delete('/secret/:category/:name', async (c) => {
    const { category, name } = c.req.param()
    try {
      const index = await host.secrets.list(category)
      if (!index.some((e) => e.name === name)) return c.json({ message: `nothing stored as ${category}/${name}` }, 404)
      await host.secrets.delete(category, name)
      return c.json({ ok: true })
    } catch (err) {
      return c.json(message(err), 500)
    }
  })

  // The Google Cloud client pair, once.
  app.post('/google/client', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { clientId?: unknown; clientSecret?: unknown } | null
    const clientId = typeof body?.clientId === 'string' ? body.clientId.trim() : ''
    const clientSecret = typeof body?.clientSecret === 'string' ? body.clientSecret.trim() : ''
    if (!clientId || !clientSecret) return c.json({ message: 'the client needs an ID and a secret' }, 400)
    try {
      await saveOAuthClient(host.secrets, { clientId, clientSecret })
      return c.json({ ok: true })
    } catch (err) {
      return c.json(message(err), 500)
    }
  })

  // A sign-in: the URL the browser opens, and an id to ask after.
  app.post('/google/connect', async (c) => {
    try {
      const started = await host.google.connect()
      if (!started) return c.json({ message: 'Save the Google Cloud client first.' }, 409)
      return c.json(started)
    } catch (err) {
      return c.json(message(err), 500)
    }
  })
  app.get('/google/connect/:id', (c) => {
    const state = host.google.connection(c.req.param('id'))
    return state ? c.json(state) : c.json({ message: 'no such sign-in' }, 404)
  })

  return app
}
