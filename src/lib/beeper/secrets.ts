import { createSecret } from '#lib/secrets/marshal.ts'
import type { SecretsProvider } from '#lib/secrets/SecretsProvider.ts'
import type { BeeperGrant } from './oauth.ts'

/** The keychain entry: one grant for the desktop app on this Mac. */
export const BEEPER_SECRETS_CATEGORY = 'beeper'
export const BEEPER_GRANT_ENTRY = 'desktop'

export async function loadBeeperGrant(secrets: SecretsProvider): Promise<BeeperGrant | null> {
  const entry = await secrets.get(BEEPER_SECRETS_CATEGORY, BEEPER_GRANT_ENTRY)
  if (!entry || entry.type !== 'secret') return null
  try {
    const parsed = JSON.parse(entry.val) as Partial<BeeperGrant>
    if (typeof parsed.token !== 'string' || !parsed.token) return null
    return {
      token: parsed.token,
      ...(typeof parsed.expiresAt === 'string' ? { expiresAt: parsed.expiresAt } : {}),
      ...(typeof parsed.scope === 'string' ? { scope: parsed.scope } : {}),
      source: parsed.source === 'oauth' ? 'oauth' : 'pasted',
    }
  } catch {
    return null
  }
}

export async function saveBeeperGrant(secrets: SecretsProvider, grant: BeeperGrant): Promise<void> {
  await secrets.set(BEEPER_SECRETS_CATEGORY, BEEPER_GRANT_ENTRY, createSecret(JSON.stringify(grant), 'Beeper Desktop'))
}

export async function deleteBeeperGrant(secrets: SecretsProvider): Promise<void> {
  await secrets.delete(BEEPER_SECRETS_CATEGORY, BEEPER_GRANT_ENTRY)
}
