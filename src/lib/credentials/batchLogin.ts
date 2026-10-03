import * as path from 'node:path'
import { DIR_STATE } from '#config'
import type { SecretsProvider } from '#lib/secrets/SecretsProvider.ts'
import { CredentialBindings } from './bindings.ts'
import { connectOnePassword } from './connect.ts'
import { credentialError, CredentialError } from './errors.ts'
import { secureOrigin, type LoginValues } from './login.ts'
import { PasswordManagerSettingsStore, type SavedPasswordManager } from './passwordManagers.ts'
import { SensitiveValue } from './SensitiveValue.ts'
import type {
  CredentialListing,
  CredentialSummary,
  CredentialWebsite,
  FieldSelector,
  FieldValue,
  ItemRef,
} from './types.ts'

// Where a batch integration's login comes from — a feature with a persistent
// browser profile of its own that signs back in with nobody at the machine
// (see lib/browser/storedLogin.ts). Looked for in this order:
//   1. the login the person picked for this purpose before (the bindings file);
//   2. the one Login item in a connected password manager whose saved website
//      names the integration's origin — its host, else a parent domain of it —
//      remembered as (1) once used; several such items are the person's to
//      choose between, once;
//   3. the integration's own entry in Sky's keychain.
// The grant is connecting the account under Settings → Browser automation, or
// saving the keychain entry, and switching the integration on: the owner's
// ruling of 2026-09-30 for batch integrations' own origins. Trusted code only.
// The purpose and origin are the integration's, never-fill items and excluded
// vaults stay out, and the values travel as SensitiveValues the sign-in
// consumes. A model sees none of it.

export interface BatchLoginChoice {
  ref: ItemRef
  title: string
  account: string
  vault: string
}

export type BatchLogin =
  | { status: 'found'; source: 'password-manager' | 'keychain'; login: LoginValues; where: string }
  /** Several logins carry the origin; the person picks once (`pickBatchLogin`, then `bindBatchLogin`). */
  | { status: 'choose'; choices: BatchLoginChoice[] }
  /** A password manager could not answer — locked, waiting for approval, unreachable — and nothing else had it. */
  | { status: 'locked'; message: string }
  | { status: 'none' }

export interface BatchLoginRequest {
  /** The integration's key for its pick, such as `atlas/login`. */
  purpose: string
  /** The exact HTTPS origin the login is for. */
  origin: string
  /** The integration's entry in Sky's keychain, taken when no password manager has the login. */
  keychain?: { secrets: SecretsProvider; category: string; name: string }
  /** How long a password manager gets to answer; a locked app can hold a request until a person comes. */
  timeoutMs?: number
  log?: (line: string) => void
}

export interface BatchLoginProvider {
  list(): Promise<CredentialListing>
  readFields(ref: ItemRef, fields: readonly FieldSelector[]): Promise<FieldValue[]>
}

/**
 * Whether a saved website names the integration's origin. The private worker
 * demands the exact HTTPS origin on the item, because the page a model is on
 * could be anywhere. Here the origin is fixed in the integration's code, so the
 * question is only which item is this integration's login — and a website
 * saved the way people save them, `atlas.example` or `www.atlas.example` with
 * or without a scheme, names it as surely. The same host first; failing that,
 * a parent domain of it on a label boundary. Never-fill entries and lookalike
 * suffixes stay out.
 */
export function websiteNamesOrigin(site: CredentialWebsite, origin: string): 'host' | 'parent' | null {
  if (site.match === 'never') return null
  const target = new URL(origin).hostname.toLowerCase()
  let host: string
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(site.url) ? site.url : `https://${site.url}`).hostname.toLowerCase()
  } catch {
    return null
  }
  if (!host) return null
  if (host === target) return 'host'
  return host.includes('.') && target.endsWith(`.${host}`) ? 'parent' : null
}

function loginRank(item: CredentialSummary, origin: string): 'host' | 'parent' | null {
  if (item.nativeCategory !== 'Login') return null
  const ranks = item.websites.map((site) => websiteNamesOrigin(site, origin))
  return ranks.includes('host') ? 'host' : ranks.includes('parent') ? 'parent' : null
}

// A Login item's built-in fields, read whole. The website was matched at the
// listing, by the rule above rather than the worker's exact-origin read.
const LOGIN_FIELDS: readonly FieldSelector[] = [{ id: 'username' }, { id: 'password' }]

async function readLoginFields(provider: BatchLoginProvider, ref: ItemRef): Promise<LoginValues> {
  const values = await provider.readFields(ref, LOGIN_FIELDS)
  const username = values.find((value) => value.field.id === 'username')?.value
  const password = values.find((value) => value.field.id === 'password')?.value
  if (!username || !password) throw new CredentialError('not-found')
  return { username, password }
}

/** Replaceable in tests; production reads Sky's state files and the desktop app. */
export interface BatchLoginDeps {
  sourcesFile: string
  bindingsFile: string
  connect: (source: SavedPasswordManager) => Promise<BatchLoginProvider>
}

export function batchLoginDeps(): BatchLoginDeps {
  const dir = path.join(DIR_STATE, 'credentials')
  return {
    sourcesFile: path.join(dir, 'sources.json'),
    bindingsFile: path.join(dir, 'bindings.json'),
    connect: (source) =>
      connectOnePassword({
        id: source.id,
        account: source.account,
        label: source.label,
        excludedVaultIds: source.excludedVaultIds,
      }),
  }
}

const DEFAULT_TIMEOUT_MS = 30_000
// The bindings file keeps field references; a login is read whole, so one reference stands for it.
const LOGIN_FIELD = 'login'

class LoginTimeout extends Error {}

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new LoginTimeout()), ms)
  })
  try {
    return await Promise.race([work, late])
  } finally {
    clearTimeout(timer)
  }
}

const blockedBy = (error: unknown): string =>
  error instanceof LoginTimeout
    ? '1Password did not answer in time; it may be locked or waiting for your approval.'
    : credentialError(error).message

const vaultLabel = (source: SavedPasswordManager, containerId: string): string =>
  source.containers.find((container) => container.id === containerId)?.label ?? containerId

export async function findBatchLogin(
  request: BatchLoginRequest,
  deps: BatchLoginDeps = batchLoginDeps(),
): Promise<BatchLogin> {
  const origin = secureOrigin(request.origin)
  if (!origin || origin !== request.origin || !request.purpose.trim()) throw new CredentialError('invalid-input')
  const say = (line: string) => request.log?.(line)
  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const bindings = new CredentialBindings(deps.bindingsFile)
  // Why a password manager could not answer, kept for the end: a keychain entry may still stand in.
  let blocker: string | undefined

  let sources: SavedPasswordManager[] = []
  try {
    sources = (await new PasswordManagerSettingsStore(deps.sourcesFile).read()).sources
  } catch {
    blocker = 'The password manager settings could not be read.'
  }

  const providers = new Map<string, Promise<BatchLoginProvider>>()
  const reach = (source: SavedPasswordManager): Promise<BatchLoginProvider> => {
    let pending = providers.get(source.id)
    if (!pending) {
      pending = withTimeout(deps.connect(source), timeoutMs)
      pending.catch(() => {})
      providers.set(source.id, pending)
    }
    return pending
  }
  const read = async (source: SavedPasswordManager, ref: ItemRef): Promise<BatchLogin> => ({
    status: 'found',
    source: 'password-manager',
    login: await readLoginFields(await reach(source), ref),
    where: `1Password (${source.label})`,
  })

  // 1. The pick made before.
  const ref = (await bindings.get(request.purpose).catch(() => null))?.fields[LOGIN_FIELD]?.item
  if (ref) {
    const source = sources.find((candidate) => candidate.id === ref.connectionId)
    if (!source) {
      await bindings.unlink(request.purpose)
      say('The remembered login’s account is no longer connected; looking again.')
    } else {
      try {
        return await read(source, ref)
      } catch (error) {
        const failure = credentialError(error)
        if (error instanceof LoginTimeout || !['not-found', 'excluded', 'invalid-input'].includes(failure.code)) {
          blocker = blockedBy(error)
        } else {
          // Gone, moved out of reach, or its website changed: forget the pick and look again.
          await bindings.unlink(request.purpose)
          say('The remembered login no longer fits; looking again.')
        }
      }
    }
  }

  // 2. The connected accounts: the exact host first, the root domain when no item names the host.
  const ranked: { choice: BatchLoginChoice; rank: 'host' | 'parent' }[] = []
  for (const source of sources) {
    let listing: CredentialListing
    try {
      listing = await (await reach(source)).list()
    } catch (error) {
      blocker = blockedBy(error)
      continue
    }
    for (const item of listing.items) {
      const rank = loginRank(item, origin)
      if (rank)
        ranked.push({
          rank,
          choice: {
            ref: item.ref,
            title: item.title,
            account: source.label,
            vault: vaultLabel(source, item.ref.containerId),
          },
        })
    }
    // A vault that could not be read is not an empty vault.
    if (listing.issues.length) blocker ??= listing.issues[0].error.message
  }
  const best = ranked.some((entry) => entry.rank === 'host') ? 'host' : 'parent'
  const choices = ranked.filter((entry) => entry.rank === best).map((entry) => entry.choice)
  if (choices.length === 1) {
    const [choice] = choices
    const source = sources.find((candidate) => candidate.id === choice.ref.connectionId)!
    try {
      const found = await read(source, choice.ref)
      await bindings.save({ purpose: request.purpose, fields: { [LOGIN_FIELD]: { item: choice.ref, id: 'password' } } })
      return found
    } catch (error) {
      blocker = blockedBy(error)
    }
  } else if (choices.length > 1) {
    return { status: 'choose', choices }
  }

  // 3. The keychain entry.
  if (request.keychain) {
    const { secrets, category, name } = request.keychain
    const entry = await secrets.get(category, name)
    if (entry?.type === 'login' && entry.user && entry.pass) {
      return {
        status: 'found',
        source: 'keychain',
        login: { username: new SensitiveValue(entry.user), password: new SensitiveValue(entry.pass) },
        where: 'the keychain',
      }
    }
  }
  return blocker ? { status: 'locked', message: blocker } : { status: 'none' }
}

/** Remember the person's pick for a purpose; the next lookup reads it without a search. */
export function bindBatchLogin(purpose: string, ref: ItemRef, deps: BatchLoginDeps = batchLoginDeps()): Promise<void> {
  return new CredentialBindings(deps.bindingsFile).save({
    purpose,
    fields: { [LOGIN_FIELD]: { item: ref, id: 'password' } },
  })
}

export function unbindBatchLogin(purpose: string, deps: BatchLoginDeps = batchLoginDeps()): Promise<void> {
  return new CredentialBindings(deps.bindingsFile).unlink(purpose)
}

/** The person's choice between several matching logins, asked in the terminal. Null when they cancel. */
export async function pickBatchLogin(question: string, choices: BatchLoginChoice[]): Promise<BatchLoginChoice | null> {
  const prompts = await import('@clack/prompts')
  const picked = await prompts.select({
    message: question,
    options: choices.map((choice, index) => ({
      value: index,
      label: choice.title,
      hint: `${choice.account} · ${choice.vault}`,
    })),
  })
  return prompts.isCancel(picked) ? null : choices[picked]
}
