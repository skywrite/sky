import { createOpenAI, type OpenAIProvider } from '@ai-sdk/openai'
import { KeychainSecretsProvider } from '#lib/secrets/KeychainSecretsProvider.ts'
import type { SecretsProvider } from '#lib/secrets/SecretsProvider.ts'

/**
 * Cerebras provider for the Vercel AI SDK.
 *
 * Cerebras speaks the OpenAI chat-completions dialect, so the provider is the
 * OpenAI one pointed at their host — models come from `.chat(id)`, never the
 * Responses API, which Cerebras does not serve. The API key lives in the OS
 * keychain (`sky secrets:set cerebras main`), not in the environment: the
 * registry builds providers synchronously and a keychain read is async, so the
 * key is fetched on the first request and held for the life of the process.
 * The CLI, the VS Code extension and the launchd daemon all resolve it the
 * same way. A missing key fails on the first call with the command that fixes
 * it, and the miss is not cached — storing the key needs no restart.
 */
export const CEREBRAS_BASE_URL = 'https://api.cerebras.ai/v1'
export const CEREBRAS_SECRET = { category: 'cerebras', name: 'main' } as const

export const MISSING_CEREBRAS_KEY =
  `No Cerebras API key in the keychain — run \`sky secrets:set ${CEREBRAS_SECRET.category} ${CEREBRAS_SECRET.name}\` ` +
  'and store the key from cloud.cerebras.ai as a secret.'

async function readKey(secrets: SecretsProvider): Promise<string> {
  const entry = await secrets.get(CEREBRAS_SECRET.category, CEREBRAS_SECRET.name)
  const key = entry?.type === 'login' ? entry.pass : entry?.val
  if (!key) throw new Error(MISSING_CEREBRAS_KEY)
  return key
}

/**
 * A fetch that signs every request with the keychain key. The key is read on
 * the first request and reused; a failed read is not remembered.
 */
export function keychainAuthFetch(secrets: SecretsProvider, base: typeof fetch = fetch): typeof fetch {
  let key: string | undefined
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    key ??= await readKey(secrets)
    const headers = new Headers(init?.headers)
    headers.set('authorization', `Bearer ${key}`)
    return base(input, { ...init, headers })
  }) as typeof fetch
}

export function createCerebrasProvider(options: { secrets: SecretsProvider; fetch?: typeof fetch }): OpenAIProvider {
  return createOpenAI({
    name: 'cerebras',
    baseURL: CEREBRAS_BASE_URL,
    // The SDK insists on a key at construction; the real one rides in on the fetch.
    apiKey: 'keychain',
    fetch: keychainAuthFetch(options.secrets, options.fetch),
  })
}

let _cerebras: OpenAIProvider | null = null

/** The process-wide Cerebras provider, keyed from the OS keychain. */
export function cerebras(): OpenAIProvider {
  _cerebras ??= createCerebrasProvider({ secrets: new KeychainSecretsProvider() })
  return _cerebras
}
