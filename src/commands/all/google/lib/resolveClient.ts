import * as p from '@clack/prompts'
import {
  AccountResolutionError,
  AmbiguousAccountError,
  GoogleClient,
  listAccountEmails,
  loadAccountClient,
  resolveAccountEmail,
} from '#lib/google/mod.ts'
import type { SecretsProvider } from '#lib/secrets/SecretsProvider.ts'

/**
 * Build an authenticated GoogleClient for the requested account.
 * Ambiguity falls back to an interactive picker when the command runs from
 * the CLI; composed callers get the error instead. Throws
 * AccountResolutionError with a user-ready message on every failure path.
 */
export async function resolveGoogleClient(options: {
  secrets: SecretsProvider
  requested?: string
  interactive: boolean
}): Promise<GoogleClient> {
  const stored = await listAccountEmails(options.secrets)
  let email: string
  try {
    email = resolveAccountEmail({ requested: options.requested, stored })
  } catch (err) {
    if (!(err instanceof AmbiguousAccountError) || !options.interactive) throw err
    const selected = await p.select({
      message: 'Which Google account?',
      options: err.candidates.map((value) => ({ value, label: value })),
    })
    if (p.isCancel(selected)) throw new AccountResolutionError('Cancelled')
    email = selected
  }

  // The pair that issued the grant — an account Sky set up has its own.
  const oauthClient = await loadAccountClient(options.secrets, email)
  if (!oauthClient) {
    throw new AccountResolutionError(`No Google OAuth client stored for ${email}. Run: sky google:auth`)
  }
  return new GoogleClient({ secrets: options.secrets, email, client: oauthClient })
}
