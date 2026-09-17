import type { SecretsProvider } from '#lib/secrets/SecretsProvider.ts'

/** Where a provider's key lives in the keychain: `sky secrets:set <category> <name>`. */
export interface KeychainSecret {
  readonly category: string
  readonly name: string
}

async function readKey(secrets: SecretsProvider, secret: KeychainSecret, missing: string): Promise<string> {
  const entry = await secrets.get(secret.category, secret.name)
  const key = entry?.type === 'login' ? entry.pass : entry?.val
  if (!key) throw new Error(missing)
  return key
}

/**
 * A fetch that signs every request with a key from the OS keychain.
 *
 * A provider's SDK insists on a key at construction and the registry builds
 * providers synchronously, while a keychain read is async — so the SDK gets
 * a placeholder and the real key rides in here: read on the first request
 * and held for the life of the process. A missing key fails that request
 * with `missing` (the words that say where the key goes) and is not
 * remembered, so storing the key needs no restart. The CLI, the VS Code
 * extension and the launchd daemon all take this path.
 */
export function keychainAuthFetch(
  secrets: SecretsProvider,
  secret: KeychainSecret,
  missing: string,
  base: typeof fetch = fetch,
): typeof fetch {
  let key: string | undefined
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    key ??= await readKey(secrets, secret, missing)
    const headers = new Headers(init?.headers)
    headers.set('authorization', `Bearer ${key}`)
    return base(input, { ...init, headers })
  }) as typeof fetch
}
