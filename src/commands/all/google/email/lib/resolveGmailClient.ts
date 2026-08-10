import { AccountResolutionError, hasGmailScope, loadAccountTokens } from '#lib/google/mod.ts'
import type { GoogleClient } from '#lib/google/mod.ts'
import type { SecretsProvider } from '#lib/secrets/SecretsProvider.ts'
import { resolveGoogleClient } from '../../lib/resolveClient.ts'

/**
 * Resolve an authenticated GoogleClient and require the Gmail scope on its
 * stored grant — grants issued before the scope was added need a google:auth
 * re-run. Throws AccountResolutionError with a user-ready message, matching
 * resolveGoogleClient's failure contract.
 */
export async function resolveGmailClient(options: {
  secrets: SecretsProvider
  requested?: string
  interactive: boolean
}): Promise<GoogleClient> {
  const client = await resolveGoogleClient(options)
  const tokens = await loadAccountTokens(options.secrets, client.email)
  if (!tokens || !hasGmailScope(tokens)) {
    throw new AccountResolutionError(
      `The stored Google grant for ${client.email} lacks the Gmail scope. Re-run: sky google:auth`,
    )
  }
  return client
}
