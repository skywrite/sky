import { createOpenAI } from '@ai-sdk/openai'
import { KeychainSecretsProvider } from '#lib/secrets/KeychainSecretsProvider.ts'
import type { SecretsProvider } from '#lib/secrets/SecretsProvider.ts'
import { withOpenAITokenCount } from '#shared/ai/inputTokenLimit.ts'
import { keychainAuthFetch, readKey } from '#shared/ai/keychainAuthFetch.ts'

/** OpenAI's key: the keychain's, stored under Settings › Connections › OpenAI, else OPENAI_API_KEY from src/.env. */
export const OPENAI_SECRET = { category: 'openai', name: 'main', env: 'OPENAI_API_KEY' } as const

export const MISSING_OPENAI_KEY =
  'No OpenAI API key. Add one under Settings › Connections › OpenAI, or run `sky secrets:set openai main`.'

const keychain = new KeychainSecretsProvider()

export const openai = createOpenAI({
  // The SDK insists on a key at construction; the real one rides in on the fetch.
  apiKey: 'keychain',
  fetch: keychainAuthFetch(
    keychain,
    OPENAI_SECRET,
    MISSING_OPENAI_KEY,
    withOpenAITokenCount(((input, init) => fetch(input, init)) as typeof fetch),
  ),
})

/** The key itself, for the openai package's clients: voice calls, transcription, images. */
export function openaiKey(secrets: SecretsProvider = keychain): Promise<string> {
  return readKey(secrets, OPENAI_SECRET, MISSING_OPENAI_KEY)
}
