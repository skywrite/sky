import { createSecret } from '#lib/secrets/marshal.ts'
import type { SecretsProvider } from '#lib/secrets/SecretsProvider.ts'
import type { NotionGrant } from './oauth.ts'

/** The keychain entry: one grant, for the workspace the person chose when signing in. */
export const NOTION_SECRETS_CATEGORY = 'notion'
export const NOTION_GRANT_ENTRY = 'workspace'

const optional = (value: unknown) => (typeof value === 'string' && value ? value : undefined)

export async function loadNotionGrant(secrets: SecretsProvider): Promise<NotionGrant | null> {
  const entry = await secrets.get(NOTION_SECRETS_CATEGORY, NOTION_GRANT_ENTRY)
  if (!entry || entry.type !== 'secret') return null
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(entry.val) as Record<string, unknown>
  } catch {
    return null
  }
  const accessToken = optional(parsed.accessToken)
  const clientId = optional(parsed.clientId)
  const tokenEndpoint = optional(parsed.tokenEndpoint)
  if (!accessToken || !clientId || !tokenEndpoint) return null
  const grant: NotionGrant = { accessToken, clientId, tokenEndpoint }
  for (const key of ['refreshToken', 'expiresAt', 'revocationEndpoint', 'workspace', 'user', 'email'] as const) {
    const value = optional(parsed[key])
    if (value) grant[key] = value
  }
  return grant
}

export async function saveNotionGrant(secrets: SecretsProvider, grant: NotionGrant): Promise<void> {
  await secrets.set(NOTION_SECRETS_CATEGORY, NOTION_GRANT_ENTRY, createSecret(JSON.stringify(grant), 'Notion'))
}

export async function deleteNotionGrant(secrets: SecretsProvider): Promise<void> {
  await secrets.delete(NOTION_SECRETS_CATEGORY, NOTION_GRANT_ENTRY)
}
