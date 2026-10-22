/**
 * The model providers' keys under Settings › Connections › Services —
 * Anthropic, OpenAI and Cerebras — the way `sky secrets:set <provider> main`
 * stores them, except that the page asks the provider first, so a mistyped
 * key never lands. Saving or removing one tells this process (forgetKey), so
 * the service's next request is signed with the change. A key still in
 * src/.env reads as such until one is saved here; the keychain's wins. Every
 * look asks the provider again, so a revoked key reads as refused.
 */

import { Hono } from 'hono'
import { createSecret, updateEntry } from '#lib/secrets/marshal.ts'
import type { SecretsProvider } from '#lib/secrets/SecretsProvider.ts'
import { type EnvLookup, findKey, forgetKey, type KeySource } from '#shared/ai/keychainAuthFetch.ts'
import {
  checkProviderKey,
  PROVIDER_KEY_IDS,
  PROVIDER_KEYS,
  type ProviderKeyCheck,
  type ProviderKeyId,
} from '#shared/ai/llm/providerKeys.ts'
import { tailOf } from './connections.ts'

/** A provider's key on this machine: where Sky finds it, and whether the provider takes it. */
export type ProviderKeyStatus = {
  /** Where the key Sky uses comes from: the keychain, an environment variable from src/.env, or nowhere */
  source: KeySource | null
  /** The variable, when the key comes from the environment */
  env?: string
  /** The key's last four characters, when it is long enough that they give nothing away */
  tail?: string
  /** The provider turned the key away: mistyped, or revoked since */
  refused?: boolean
  /** Why the provider could not be asked, or what it said, in plain words */
  error?: string
}

export interface ProviderKeysHost {
  status: (id: ProviderKeyId) => Promise<ProviderKeyStatus>
  /** Check a pasted key with the provider, then store it; a refusal names what went wrong */
  save: (id: ProviderKeyId, key: string) => Promise<{ ok: true } | { ok: false; message: string }>
  /** Take the keychain's key out; a key in src/.env stays */
  remove: (id: ProviderKeyId) => Promise<void>
}

export function createProviderKeysHost(
  secrets: SecretsProvider,
  options: {
    /** Asks the provider; tests script it */
    check?: (id: ProviderKeyId, key: string) => Promise<ProviderKeyCheck>
    /** Reads src/.env's variables; tests pass their own */
    lookup?: EnvLookup
  } = {},
): ProviderKeysHost {
  const { check = checkProviderKey, lookup } = options
  const stored = async (id: ProviderKeyId) => {
    const { category, name } = PROVIDER_KEYS[id].secret
    return (await secrets.list(category)).some((entry) => entry.name === name)
  }
  return {
    async status(id) {
      const { secret } = PROVIDER_KEYS[id]
      const found = await findKey(secrets, secret, lookup)
      if (!found) return { source: null }
      const tail = tailOf(found.key)
      const status: ProviderKeyStatus = {
        source: found.source,
        ...(found.source === 'env' && 'env' in secret ? { env: secret.env } : {}),
        ...(tail ? { tail } : {}),
      }
      const checked = await check(id, found.key)
      if (checked.ok) return status
      return { ...status, ...(checked.refused ? { refused: true } : {}), error: checked.message }
    },
    async save(id, key) {
      const checked = await check(id, key)
      if (!checked.ok) return { ok: false, message: checked.message }
      const { secret } = PROVIDER_KEYS[id]
      const existing = (await stored(id)) ? await secrets.get(secret.category, secret.name) : null
      await secrets.set(
        secret.category,
        secret.name,
        existing?.type === 'secret' ? updateEntry(existing, { val: key }) : createSecret(key),
      )
      forgetKey(secret)
      return { ok: true }
    },
    async remove(id) {
      const { secret } = PROVIDER_KEYS[id]
      if (await stored(id)) await secrets.delete(secret.category, secret.name)
      forgetKey(secret)
    },
  }
}

const message = (err: unknown) => ({ message: err instanceof Error ? err.message : String(err) })

/** `/keys/:provider` under Connections: the status, a pasted key, and its removal. */
export function createProviderKeyRoutes(host: ProviderKeysHost): Hono {
  const app = new Hono()
  const providerOf = (param: string) => PROVIDER_KEY_IDS.find((id) => id === param)
  const unknown = (param: string) => ({ message: `Sky keeps no API key for “${param}”.` })

  app.get('/:provider', async (c) => {
    const id = providerOf(c.req.param('provider'))
    if (!id) return c.json(unknown(c.req.param('provider')), 404)
    try {
      return c.json(await host.status(id))
    } catch (err) {
      return c.json(message(err), 500)
    }
  })
  app.post('/:provider', async (c) => {
    const id = providerOf(c.req.param('provider'))
    if (!id) return c.json(unknown(c.req.param('provider')), 404)
    const body = (await c.req.json().catch(() => null)) as { key?: unknown } | null
    const key = typeof body?.key === 'string' ? body.key.trim() : ''
    if (!key) return c.json({ message: `Paste the API key from ${PROVIDER_KEYS[id].console}.` }, 400)
    try {
      const saved = await host.save(id, key)
      return saved.ok ? c.json({ ok: true }) : c.json({ message: saved.message }, 400)
    } catch (err) {
      return c.json(message(err), 500)
    }
  })
  app.delete('/:provider', async (c) => {
    const id = providerOf(c.req.param('provider'))
    if (!id) return c.json(unknown(c.req.param('provider')), 404)
    try {
      await host.remove(id)
      return c.json({ ok: true })
    } catch (err) {
      return c.json(message(err), 500)
    }
  })
  return app
}
