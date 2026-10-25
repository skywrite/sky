import type { SecretsProvider } from '#lib/secrets/SecretsProvider.ts'
import { env } from '#shared/sys/mod.ts'

/** Where a provider's key lives in the keychain: `sky secrets:set <category> <name>`. */
export interface KeychainSecret {
  readonly category: string
  readonly name: string
  /**
   * The environment variable that holds the key when the keychain does not —
   * where OpenAI's and Anthropic's keys lived (src/.env) before Settings could
   * store them. The keychain's key wins.
   */
  readonly env?: string
  /** The header the provider reads the key from; unset is `Authorization: Bearer`. */
  readonly header?: 'x-api-key'
}

/** Where a key was found. */
export type KeySource = 'keychain' | 'env'

/** Reads one environment variable; tests pass their own. */
export type EnvLookup = (name: string) => string | undefined

/**
 * The key and where it was found, or null. A key the environment can stand in
 * for is looked up in the keychain only when the secrets index lists it, so a
 * Mac whose keys still live in src/.env never waits on the keychain for them.
 */
export async function findKey(
  secrets: SecretsProvider,
  secret: KeychainSecret,
  lookup: EnvLookup = env.get,
): Promise<{ key: string; source: KeySource } | null> {
  const listed = !secret.env || (await secrets.list(secret.category)).some((entry) => entry.name === secret.name)
  if (listed) {
    const entry = await secrets.get(secret.category, secret.name)
    const key = entry?.type === 'login' ? entry.pass : entry?.val
    if (key) return { key, source: 'keychain' }
  }
  const fromEnv = secret.env ? lookup(secret.env) : undefined
  return fromEnv ? { key: fromEnv, source: 'env' } : null
}

/** Whether there is a key to use, without reading one out: the environment holds it, or the index lists it. */
export async function hasKey(
  secrets: SecretsProvider,
  secret: KeychainSecret,
  lookup: EnvLookup = env.get,
): Promise<boolean> {
  if (secret.env && lookup(secret.env)) return true
  return (await secrets.list(secret.category)).some((entry) => entry.name === secret.name)
}

/** The key, for an SDK that takes it whole; `missing` (the words that say where the key goes) when there is none. */
export async function readKey(secrets: SecretsProvider, secret: KeychainSecret, missing: string): Promise<string> {
  const found = await findKey(secrets, secret)
  if (!found) throw new Error(missing)
  return found.key
}

/** Bumped when Settings stores or removes a key, so every fetch holding the old one reads again. */
const changes = new Map<string, number>()
const slotOf = (secret: KeychainSecret) => `${secret.category}/${secret.name}`

/** A key was stored or removed in this process: the next request through any fetch for it reads again. */
export function forgetKey(secret: KeychainSecret): void {
  changes.set(slotOf(secret), (changes.get(slotOf(secret)) ?? 0) + 1)
}

/** Cancel only this caller's wait; the secrets provider may share the underlying read with another caller. */
async function waitForKey(work: () => Promise<string>, signal?: AbortSignal | null): Promise<string> {
  signal?.throwIfAborted()
  if (!signal) return work()
  let abort: () => void = () => {}
  try {
    return await Promise.race([
      new Promise<never>((_, reject) => {
        abort = () => reject(signal.reason)
        signal.addEventListener('abort', abort, { once: true })
      }),
      work(),
    ])
  } finally {
    signal.removeEventListener('abort', abort)
  }
}

/**
 * A fetch that signs every request with a key from the OS keychain, or from
 * the secret's environment variable when the keychain holds none.
 *
 * A provider's SDK insists on a key at construction and the registry builds
 * providers synchronously, while a keychain read is async — so the SDK gets
 * a placeholder and the real key rides in here: read on the first request
 * and held until Settings stores or removes it (forgetKey). A missing key
 * fails that request with `missing` (the words that say where the key goes)
 * and is not remembered, so storing the key needs no restart. The CLI, the
 * VS Code extension and the launchd daemon all take this path.
 */
export function keychainAuthFetch(
  secrets: SecretsProvider,
  secret: KeychainSecret,
  missing: string,
  base: typeof fetch = fetch,
): typeof fetch {
  let held: { key: string; change: number } | undefined
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const signal = init?.signal === undefined && input instanceof Request ? input.signal : init?.signal
    signal?.throwIfAborted()
    const change = changes.get(slotOf(secret)) ?? 0
    if (held?.change !== change)
      held = { key: await waitForKey(() => readKey(secrets, secret, missing), signal), change }
    signal?.throwIfAborted()
    const headers = new Headers(init?.headers)
    if (secret.header === 'x-api-key') headers.set('x-api-key', held.key)
    else headers.set('authorization', `Bearer ${held.key}`)
    return base(input, { ...init, headers })
  }) as typeof fetch
}
