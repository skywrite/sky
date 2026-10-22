import type { KeychainSecret } from '#shared/ai/keychainAuthFetch.ts'
import { ANTHROPIC_SECRET } from './anthropicProvider.ts'
import { CEREBRAS_BASE_URL, CEREBRAS_SECRET } from './cerebrasProvider.ts'
import { OPENAI_SECRET } from './openaiProvider.ts'

/**
 * The model providers whose keys Settings keeps, each with the cheapest
 * request that proves a key: listing the models it may use.
 */
export const PROVIDER_KEYS = {
  anthropic: {
    label: 'Anthropic',
    secret: ANTHROPIC_SECRET,
    console: 'console.anthropic.com',
    models: 'https://api.anthropic.com/v1/models?limit=1',
    headers: (key: string): Record<string, string> => ({ 'x-api-key': key, 'anthropic-version': '2023-06-01' }),
  },
  openai: {
    label: 'OpenAI',
    secret: OPENAI_SECRET,
    console: 'platform.openai.com',
    models: 'https://api.openai.com/v1/models',
    headers: (key: string): Record<string, string> => ({ authorization: `Bearer ${key}` }),
  },
  cerebras: {
    label: 'Cerebras',
    secret: CEREBRAS_SECRET,
    console: 'cloud.cerebras.ai',
    models: `${CEREBRAS_BASE_URL}/models`,
    headers: (key: string): Record<string, string> => ({ authorization: `Bearer ${key}` }),
  },
} as const satisfies Record<
  string,
  {
    label: string
    secret: KeychainSecret
    /** Where the person makes a key */
    console: string
    models: string
    headers: (key: string) => Record<string, string>
  }
>

export type ProviderKeyId = keyof typeof PROVIDER_KEYS
export const PROVIDER_KEY_IDS = Object.keys(PROVIDER_KEYS) as ProviderKeyId[]

/** What a key check answers. */
export type ProviderKeyCheck =
  | { ok: true }
  | {
      ok: false
      /** The provider turned the key away: mistyped, revoked, or not allowed to list models */
      refused: boolean
      message: string
    }

const CHECK_TIMEOUT_MS = 10_000

/** Ask the provider whether it takes a key. Its own words on a refusal are kept: they say why. */
export async function checkProviderKey(
  id: ProviderKeyId,
  key: string,
  base: typeof fetch = fetch,
): Promise<ProviderKeyCheck> {
  const { label, models, headers } = PROVIDER_KEYS[id]
  let response: Response
  try {
    response = await base(models, { headers: headers(key), signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) })
  } catch (error) {
    const timedOut = (error as { name?: unknown } | null)?.name === 'TimeoutError'
    return {
      ok: false,
      refused: false,
      message: timedOut ? `${label} did not answer in time.` : `${label} could not be reached.`,
    }
  }
  if (response.ok) {
    await response.body?.cancel()
    return { ok: true }
  }
  const body = (await response.json().catch(() => null)) as { error?: { message?: unknown }; message?: unknown } | null
  const said = body?.error?.message ?? body?.message
  const detail = typeof said === 'string' && said.trim() ? ` ${said.trim()}` : ''
  if (response.status === 401 || response.status === 403)
    return { ok: false, refused: true, message: `${label} refused the key.${detail}` }
  return { ok: false, refused: false, message: `${label} answered ${response.status}.${detail}` }
}
