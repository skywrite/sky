import { createOpenAI, type OpenAIProvider } from '@ai-sdk/openai'
import { KeychainSecretsProvider } from '#lib/secrets/KeychainSecretsProvider.ts'
import type { SecretsProvider } from '#lib/secrets/SecretsProvider.ts'
import { keychainAuthFetch } from '#shared/ai/keychainAuthFetch.ts'

/**
 * Cerebras provider for the Vercel AI SDK.
 *
 * Cerebras speaks the OpenAI chat-completions dialect, so the provider is the
 * OpenAI one pointed at their host — models come from `.chat(id)`, never the
 * Responses API, which Cerebras does not serve. The API key lives in the OS
 * keychain (`sky secrets:set cerebras main`), not in the environment, and is
 * read on the first request by the shared keychain fetch (../keychainAuthFetch.ts):
 * a missing key fails on the first call with the command that fixes it, and
 * storing the key needs no restart.
 */
export const CEREBRAS_BASE_URL = 'https://api.cerebras.ai/v1'
export const CEREBRAS_SECRET = { category: 'cerebras', name: 'main' } as const

export const MISSING_CEREBRAS_KEY =
  `No Cerebras API key in the keychain — run \`sky secrets:set ${CEREBRAS_SECRET.category} ${CEREBRAS_SECRET.name}\` ` +
  'and store the key from cloud.cerebras.ai as a secret.'

export function createCerebrasProvider(options: { secrets: SecretsProvider; fetch?: typeof fetch }): OpenAIProvider {
  return createOpenAI({
    name: 'cerebras',
    baseURL: CEREBRAS_BASE_URL,
    // The SDK insists on a key at construction; the real one rides in on the fetch.
    apiKey: 'keychain',
    fetch: keychainAuthFetch(options.secrets, CEREBRAS_SECRET, MISSING_CEREBRAS_KEY, options.fetch),
  })
}

let _cerebras: OpenAIProvider | null = null

/** The process-wide Cerebras provider, keyed from the OS keychain. */
export function cerebras(): OpenAIProvider {
  _cerebras ??= createCerebrasProvider({ secrets: new KeychainSecretsProvider() })
  return _cerebras
}
