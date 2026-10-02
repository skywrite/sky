import {
  AccountResolutionError,
  accountLookupOrder,
  hasGmailScope,
  listAccountEmails,
  loadAccountTokens,
  resolveAccountEmail,
} from '#lib/google/mod.ts'
import type { GoogleClient } from '#lib/google/mod.ts'
import type { SecretsProvider } from '#lib/secrets/SecretsProvider.ts'
import {
  type AccountCategoryOf,
  type OwningClient,
  clientFor,
  findOwningGoogleClient,
  resolveGoogleClient,
  resolveGoogleClientForNew,
  storedCategories,
} from '../../lib/resolveClient.ts'

async function holdsGmailScope(secrets: SecretsProvider, email: string): Promise<boolean> {
  const tokens = await loadAccountTokens(secrets, email)
  return Boolean(tokens && hasGmailScope(tokens))
}

/** Grants issued before the Gmail scope was added need a google:auth re-run. */
async function requireGmailScope(secrets: SecretsProvider, client: GoogleClient): Promise<GoogleClient> {
  if (!(await holdsGmailScope(secrets, client.email))) {
    throw new AccountResolutionError(
      `The stored Google grant for ${client.email} lacks the Gmail scope. Re-run: sky google:auth`,
    )
  }
  return client
}

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
  return requireGmailScope(options.secrets, await resolveGoogleClient(options))
}

/** The Gmail client a new draft is written from: the requested account, else the work account. */
export async function resolveGmailClientForNew(options: {
  secrets: SecretsProvider
  requested?: string
  interactive: boolean
  categoryOf?: AccountCategoryOf
}): Promise<GoogleClient> {
  return requireGmailScope(options.secrets, await resolveGoogleClientForNew(options))
}

/** Stored accounts split by whether their grant can read mail. */
async function gmailAccounts(secrets: SecretsProvider): Promise<{ stored: string[]; withGmail: string[] }> {
  const stored = await listAccountEmails(secrets)
  const withGmail: string[] = []
  for (const email of stored) {
    if (await holdsGmailScope(secrets, email)) withGmail.push(email)
  }
  return { stored, withGmail }
}

/**
 * Find the mailbox a thread or draft lives in, looking only through
 * accounts whose grant can read mail. A requested account without the
 * scope fails as it always did, naming the re-run.
 */
export async function findOwningGmailClient<T>(options: {
  secrets: SecretsProvider
  requested?: string
  what: string
  attempt: (client: GoogleClient) => Promise<T>
  categoryOf?: AccountCategoryOf
}): Promise<OwningClient<T>> {
  const { stored, withGmail } = await gmailAccounts(options.secrets)
  if (options.requested || stored.length === 0) {
    const email = resolveAccountEmail({ requested: options.requested, stored })
    if (!withGmail.includes(email)) {
      throw new AccountResolutionError(
        `The stored Google grant for ${email} lacks the Gmail scope. Re-run: sky google:auth`,
      )
    }
  }
  if (withGmail.length === 0) {
    throw new AccountResolutionError('No connected Google account has the Gmail scope. Re-run: sky google:auth')
  }
  return findOwningGoogleClient({ ...options, stored: withGmail })
}

/**
 * The mailboxes a listing covers: the requested account, else every account
 * whose grant can read mail, the work account first. `skipped` names the
 * connected accounts left out and why, so a listing never passes for
 * complete when an account was not read.
 */
export async function gmailClientsToList(options: {
  secrets: SecretsProvider
  requested?: string
  categoryOf?: AccountCategoryOf
}): Promise<{ clients: GoogleClient[]; skipped: Array<{ account: string; reason: string }> }> {
  const { stored, withGmail } = await gmailAccounts(options.secrets)
  if (options.requested || stored.length === 0) {
    const email = resolveAccountEmail({ requested: options.requested, stored })
    if (!withGmail.includes(email)) {
      throw new AccountResolutionError(
        `The stored Google grant for ${email} lacks the Gmail scope. Re-run: sky google:auth`,
      )
    }
    return { clients: [await clientFor(options.secrets, email)], skipped: [] }
  }
  if (withGmail.length === 0) {
    throw new AccountResolutionError('No connected Google account has the Gmail scope. Re-run: sky google:auth')
  }
  const clients: GoogleClient[] = []
  const skipped = stored
    .filter((email) => !withGmail.includes(email))
    .map((email) => ({ account: email, reason: 'no Gmail access — re-run sky google:auth' }))
  const order = accountLookupOrder({ stored: withGmail, categoryOf: options.categoryOf ?? storedCategories() })
  for (const email of order) {
    try {
      clients.push(await clientFor(options.secrets, email))
    } catch (err) {
      skipped.push({ account: email, reason: err instanceof Error ? err.message : String(err) })
    }
  }
  return { clients, skipped }
}
