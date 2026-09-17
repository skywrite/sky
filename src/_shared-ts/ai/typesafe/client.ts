import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  AuthenticationError,
  PermissionDeniedError,
  TypeSafeClient,
} from '@typesafe-ai/sdk'
import type { SecretsProvider } from '#lib/secrets/SecretsProvider.ts'
import { keychainAuthFetch } from '#shared/ai/keychainAuthFetch.ts'

/**
 * TypeSafe AI's Jev, a System One model: it answers typed questions about a
 * state — pick one of these, rate on this rubric, yes or no — with calibrated
 * probabilities, and never writes text. It is not a language model, so it
 * lives beside the registry in models.ts rather than in it: no profile, no
 * role; a caller builds its client here.
 *
 * The key lives in the OS keychain as `typesafe/main` — Settings →
 * Connections stores it after TypeSafe has accepted it, `sky secrets:set
 * typesafe main` stores it blind — and is read on the first request, the
 * way Cerebras's is (see ../keychainAuthFetch.ts). The SDK's own logging is
 * off: its debug level prints request bodies, which are notebook text.
 */
export const TYPESAFE_BASE_URL = 'https://api.typesafe.ai'
export const TYPESAFE_SECRET = { category: 'typesafe', name: 'main' } as const

export const MISSING_TYPESAFE_KEY =
  'No TypeSafe API key in the keychain — add it under Settings → Connections, ' +
  `or run \`sky secrets:set ${TYPESAFE_SECRET.category} ${TYPESAFE_SECRET.name}\` with the key from console.typesafe.ai.`

/** Per attempt. Jev answers in well under a second; a page must not hang on a host that does not. */
const TIMEOUT_MS = 10_000

/** A client keyed from the keychain. Builds at once; the key is read on the first request. */
export function createTypeSafeClient(options: { secrets: SecretsProvider; fetch?: typeof fetch }): TypeSafeClient {
  return new TypeSafeClient({
    // The SDK insists on a key at construction; the real one rides in on the fetch.
    apiKey: 'keychain',
    baseURL: TYPESAFE_BASE_URL,
    fetch: keychainAuthFetch(options.secrets, TYPESAFE_SECRET, MISSING_TYPESAFE_KEY, options.fetch),
    logLevel: 'off',
    timeout: TIMEOUT_MS,
  })
}

/** What a key check answers: the models the key may use, or why not. */
export type TypeSafeKeyCheck =
  | { ok: true; models: string[] }
  | {
      ok: false
      /** TypeSafe turned the key away: mistyped, or revoked since */
      refused: boolean
      message: string
    }

/** The cheapest request that proves a key: the models the account may use, by name. */
export async function checkTypeSafeKey(client: TypeSafeClient): Promise<TypeSafeKeyCheck> {
  try {
    const models = await client.models.list({ retry: { maxRetries: 0 } })
    return { ok: true, models: models.map((model) => model.name) }
  } catch (error) {
    return { ok: false, ...describeFailure(error) }
  }
}

/** A pasted key, checked with TypeSafe before it is stored. */
export function checkPastedTypeSafeKey(key: string, base?: typeof fetch): Promise<TypeSafeKeyCheck> {
  return checkTypeSafeKey(
    new TypeSafeClient({
      apiKey: key,
      baseURL: TYPESAFE_BASE_URL,
      logLevel: 'off',
      timeout: TIMEOUT_MS,
      ...(base ? { fetch: base } : {}),
    }),
  )
}

function describeFailure(error: unknown): { refused: boolean; message: string } {
  if (error instanceof AuthenticationError || error instanceof PermissionDeniedError)
    return { refused: true, message: 'TypeSafe refused the key.' }
  if (error instanceof APIError) return { refused: false, message: `TypeSafe answered ${error.message}` }
  if (error instanceof APITimeoutError) return { refused: false, message: 'TypeSafe did not answer in time.' }
  if (error instanceof APIConnectionError) {
    // The keychain fetch throws before any connection is made; the SDK files that as a connection error.
    if (error.cause instanceof Error && error.cause.message === MISSING_TYPESAFE_KEY)
      return { refused: false, message: MISSING_TYPESAFE_KEY }
    return { refused: false, message: 'TypeSafe could not be reached.' }
  }
  return { refused: false, message: error instanceof Error ? error.message : String(error) }
}
