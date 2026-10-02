import * as p from '@clack/prompts'
import {
  AccountResolutionError,
  AmbiguousAccountError,
  GoogleApiError,
  GoogleClient,
  accountCategory,
  accountLookupOrder,
  listAccountEmails,
  loadAccountClient,
  resolveAccountEmail,
  resolveNewItemAccountEmail,
} from '#lib/google/mod.ts'
import type { SecretsProvider } from '#lib/secrets/SecretsProvider.ts'
import { loadSkyConfig } from '#shared/config/loader.ts'
import type { GoogleAccountCategory } from '#shared/config/types.ts'

export type AccountCategoryOf = (email: string) => GoogleAccountCategory

/** Each account's side of the day, read from the config file once per resolution. */
export function storedCategories(): AccountCategoryOf {
  const config = loadSkyConfig()
  return (email) => accountCategory(email, config)
}

/** The authenticated client of one stored account. */
export async function clientFor(secrets: SecretsProvider, email: string): Promise<GoogleClient> {
  // The pair that issued the grant — an account Sky set up has its own.
  const oauthClient = await loadAccountClient(secrets, email)
  if (!oauthClient) {
    throw new AccountResolutionError(`No Google OAuth client stored for ${email}. Run: sky google:auth`)
  }
  return new GoogleClient({ secrets, email, client: oauthClient })
}

/** Resolve an account, asking in the terminal when the choice is open and someone is there to answer. */
async function chosenEmail(resolve: () => string, interactive: boolean): Promise<string> {
  try {
    return resolve()
  } catch (err) {
    if (!(err instanceof AmbiguousAccountError) || !interactive) throw err
    const selected = await p.select({
      message: 'Which Google account?',
      options: err.candidates.map((value) => ({ value, label: value })),
    })
    if (p.isCancel(selected)) throw new AccountResolutionError('Cancelled')
    return selected
  }
}

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
  const email = await chosenEmail(
    () => resolveAccountEmail({ requested: options.requested, stored }),
    options.interactive,
  )
  return clientFor(options.secrets, email)
}

/**
 * The client for something new — a draft, a document. With no account
 * requested the work account stands in, so a call from chat never stops to
 * ask which account when there is one obvious answer. A choice that is
 * still open (several work accounts) asks in the terminal and fails
 * elsewhere, as resolveGoogleClient does.
 */
export async function resolveGoogleClientForNew(options: {
  secrets: SecretsProvider
  requested?: string
  interactive: boolean
  categoryOf?: AccountCategoryOf
}): Promise<GoogleClient> {
  const stored = await listAccountEmails(options.secrets)
  const categoryOf = options.categoryOf ?? storedCategories()
  const email = await chosenEmail(
    () => resolveNewItemAccountEmail({ requested: options.requested, stored, categoryOf }),
    options.interactive,
  )
  return clientFor(options.secrets, email)
}

/**
 * The account something new would come from, without asking anyone and
 * without building a client — what an approval card shows before the run.
 * Throws as resolveGoogleClientForNew does when the choice is still open.
 */
export async function newItemAccountEmail(options: {
  secrets: SecretsProvider
  requested?: string
  categoryOf?: AccountCategoryOf
}): Promise<string> {
  return resolveNewItemAccountEmail({
    requested: options.requested,
    stored: await listAccountEmails(options.secrets),
    categoryOf: options.categoryOf ?? storedCategories(),
  })
}

export interface OwningClient<T> {
  client: GoogleClient
  /** What the attempt returned for the account that could open it */
  value: T
  /** Accounts tried first that could not open it, in the order tried */
  passed: string[]
}

/**
 * Find the account that holds something that already exists — a file, a
 * thread, a draft — by trying each account until one can open it: the
 * requested account, then the work account, then the rest. Nothing is ever
 * asked: an existing thing lives in an account, and a wrong first guess
 * only costs one call.
 *
 * A 404 means "not in this account". Any other failure is remembered and
 * the search goes on, so an account that cannot be asked (a revoked grant)
 * never hides the one that can answer; when no account opens it, that
 * failure is what the caller hears.
 */
export async function findOwningGoogleClient<T>(options: {
  secrets: SecretsProvider
  requested?: string
  /** What is looked for, as the error names it: "The file", "Gmail thread ff" */
  what: string
  attempt: (client: GoogleClient) => Promise<T>
  /** The accounts to look through, when not every stored one can serve the call */
  stored?: string[]
  categoryOf?: AccountCategoryOf
}): Promise<OwningClient<T>> {
  const stored = options.stored ?? (await listAccountEmails(options.secrets))
  const order = accountLookupOrder({
    requested: options.requested,
    stored,
    categoryOf: options.categoryOf ?? storedCategories(),
  })
  const passed: string[] = []
  let failure: unknown
  for (const email of order) {
    try {
      const client = await clientFor(options.secrets, email)
      return { client, value: await options.attempt(client), passed }
    } catch (err) {
      if (!(err instanceof GoogleApiError && err.status === 404)) failure ??= err
      passed.push(email)
    }
  }
  if (failure) throw failure
  throw new AccountResolutionError(
    `${options.what} is not in ${order.length === 1 ? order[0] : `any connected Google account (${order.join(', ')})`}. Check the link or id — or connect the account that holds it (sky google:auth).`,
  )
}

/** One line on an account switch, for the result and the log; undefined when the first account tried was the one. */
export function accountSwitchNote(found: OwningClient<unknown>): string | undefined {
  if (found.passed.length === 0) return undefined
  return `${found.passed.join(' and ')} could not open it; used ${found.client.email}.`
}
