import type { SecretsProvider } from '#lib/secrets/SecretsProvider.ts'
import { GoogleClient } from './client.ts'
import { hasGmailScope, listSendAs } from './gmail.ts'
import { listAccountEmails, loadAccountClient, loadAccountTokens } from './tokens.ts'

/**
 * Every address the owner's mail goes to and comes from: each connected
 * Google account, and the aliases its Gmail sends as. An alias is often the
 * address people actually write to (a work domain's second name), so the
 * accounts alone miss much of the owner's mail. An account Gmail cannot
 * answer for (no mail grant, offline, a revoked grant) still counts as itself.
 */
export async function listOwnAddresses(
  secrets: SecretsProvider,
  options: { fetchFn?: typeof fetch } = {},
): Promise<string[]> {
  const accounts = await listAccountEmails(secrets).catch(() => [] as string[])
  const addresses = await Promise.all(
    accounts.map(async (email) => {
      try {
        const [tokens, client] = await Promise.all([
          loadAccountTokens(secrets, email),
          loadAccountClient(secrets, email),
        ])
        if (!tokens || !client || !hasGmailScope(tokens)) return [email]
        const gmail = new GoogleClient({ secrets, email, client, fetchFn: options.fetchFn })
        return [email, ...(await listSendAs(gmail))]
      } catch {
        return [email]
      }
    }),
  )
  return [...new Set(addresses.flat().map((address) => address.trim().toLowerCase()))]
}
