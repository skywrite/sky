import { GoogleClient, getFile, loadOAuthClient } from '#lib/google/mod.ts'
import type { SecretsProvider } from '#lib/secrets/SecretsProvider.ts'

/**
 * Which of these connected accounts can see the file? Used when the mission
 * target 404s under the chosen account — Drive answers 404 both for "gone"
 * and "not yours", so the actionable difference is whether another stored
 * account has it. Probe failures of any sort count as "not visible".
 */
export async function probeAccountsForFile(
  secrets: SecretsProvider,
  emails: string[],
  fileId: string,
): Promise<string[]> {
  const oauthClient = await loadOAuthClient(secrets)
  if (!oauthClient) return []
  const visible: string[] = []
  for (const email of emails) {
    try {
      const client = new GoogleClient({ secrets, email, client: oauthClient })
      await getFile(client, fileId)
      visible.push(email)
    } catch {
      // 404, revoked grant, network — all mean this account can't serve the mission
    }
  }
  return visible
}
