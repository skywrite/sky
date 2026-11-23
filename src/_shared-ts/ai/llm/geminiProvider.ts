import { createGoogle, type GoogleProvider } from '@ai-sdk/google'
import { KeychainSecretsProvider } from '#lib/secrets/KeychainSecretsProvider.ts'
import type { SecretsProvider } from '#lib/secrets/SecretsProvider.ts'
import { keychainAuthFetch, readKey } from '#shared/ai/keychainAuthFetch.ts'

/**
 * Gemini provider for the Vercel AI SDK.
 *
 * Uses Google's Generative Language API (`generativelanguage.googleapis.com`)
 * under the `gemini` provider name so it stays separate from Google Workspace
 * OAuth (`google` keychain category and Connections › Google). The key comes
 * from the OS keychain entry `gemini/main`, else `GOOGLE_GEMINI_API_KEY` from
 * `src/.env`, and is sent in the `x-goog-api-key` header.
 */
export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'

export const GEMINI_SECRET = {
  category: 'gemini',
  name: 'main',
  env: 'GOOGLE_GEMINI_API_KEY',
  header: 'x-goog-api-key',
} as const

export const MISSING_GEMINI_KEY =
  'No Gemini API key. Add one under Settings › Connections › Gemini, or run ' +
  `\`sky secrets:set ${GEMINI_SECRET.category} ${GEMINI_SECRET.name}\`.`

export function createGeminiProvider(options: { secrets: SecretsProvider; fetch?: typeof fetch }): GoogleProvider {
  return createGoogle({
    name: 'gemini',
    baseURL: GEMINI_BASE_URL,
    // The SDK insists on a key at construction; the real one rides in on the fetch.
    apiKey: 'keychain',
    fetch: keychainAuthFetch(options.secrets, GEMINI_SECRET, MISSING_GEMINI_KEY, options.fetch),
  })
}

const keychain = new KeychainSecretsProvider()

let _gemini: GoogleProvider | null = null

/** The process-wide Gemini provider, keyed from the OS keychain or src/.env. */
export function gemini(): GoogleProvider {
  _gemini ??= createGeminiProvider({ secrets: keychain })
  return _gemini
}

/** The key itself, for a request outside the SDK. */
export function geminiKey(secrets: SecretsProvider = keychain): Promise<string> {
  return readKey(secrets, GEMINI_SECRET, MISSING_GEMINI_KEY)
}
