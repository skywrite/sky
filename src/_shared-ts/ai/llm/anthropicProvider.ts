import { createAnthropic } from '@ai-sdk/anthropic'
import { KeychainSecretsProvider } from '#lib/secrets/KeychainSecretsProvider.ts'
import type { SecretsProvider } from '#lib/secrets/SecretsProvider.ts'
import { logAIError } from '#shared/ai/errorLog.ts'
import { withAnthropicTokenCount } from '#shared/ai/inputTokenLimit.ts'
import { keychainAuthFetch, readKey } from '#shared/ai/keychainAuthFetch.ts'
import { withStreamIdleGuard } from './idleGuardFetch.ts'
import { createModelFetch } from './modelFetch.ts'

/**
 * Anthropic's key: the keychain's, stored under Settings › Connections ›
 * Anthropic, else ANTHROPIC_API_KEY from src/.env. Anthropic reads it from
 * the x-api-key header.
 */
export const ANTHROPIC_SECRET = {
  category: 'anthropic',
  name: 'main',
  env: 'ANTHROPIC_API_KEY',
  header: 'x-api-key',
} as const

export const MISSING_ANTHROPIC_KEY =
  'No Anthropic API key. Add one under Settings › Connections › Anthropic, or run `sky secrets:set anthropic main`.'

const keychain = new KeychainSecretsProvider()

/** The key itself, for a request outside the SDK: listing the models. */
export function anthropicKey(secrets: SecretsProvider = keychain): Promise<string> {
  return readKey(secrets, ANTHROPIC_SECRET, MISSING_ANTHROPIC_KEY)
}

/**
 * Claude sends SSE pings while it thinks, so Sky can detect stalled streams with its own guard.
 * The guard retries unanswered requests and fails mid-body stalls. Non-streaming calls may sit quiet for minutes
 * and use the caller's deadline. Every detected stall lands in the AI error log.
 */
const STREAM_IDLE_MS = 90_000

export const anthropic = createAnthropic({
  // The SDK insists on a key at construction; the real one rides in on the fetch,
  // outermost so the token count's preflight is signed too.
  apiKey: 'keychain',
  fetch: keychainAuthFetch(
    keychain,
    ANTHROPIC_SECRET,
    MISSING_ANTHROPIC_KEY,
    withAnthropicTokenCount(
      withStreamIdleGuard(createModelFetch({ idleTimeoutMs: false }), {
        idleMs: STREAM_IDLE_MS,
        attempts: 3,
        onIdle: (event) =>
          void logAIError({
            source: 'anthropic-provider',
            stage: 'stream-idle',
            message:
              event.phase === 'response'
                ? `no response for ${Math.round(event.idleMs / 1000)}s (attempt ${event.attempt}) — ${event.retrying ? 'retrying' : 'giving up'}`
                : `stream went silent for ${Math.round(event.idleMs / 1000)}s mid-response — aborted`,
          }),
      }),
    ),
  ),
})
