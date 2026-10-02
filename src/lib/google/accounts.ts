import type { GoogleAccountCategory } from '#shared/config/types.ts'

export class AccountResolutionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AccountResolutionError'
  }
}

export class AmbiguousAccountError extends AccountResolutionError {
  readonly candidates: string[]

  constructor(candidates: string[], message: string) {
    super(message)
    this.name = 'AmbiguousAccountError'
    this.candidates = candidates
  }
}

/**
 * Resolve which stored account a command should use.
 *
 * `requested` matches an exact email first, then a unique case-insensitive
 * substring (`--account gmail` when exactly one stored address contains it).
 * With nothing requested, a single stored account wins. Everything else throws
 * with a message that says what to do; interactive callers may catch
 * AmbiguousAccountError and prompt over `candidates` instead.
 */
export function resolveAccountEmail(options: { requested?: string; stored: string[] }): string {
  const { requested, stored } = options
  if (stored.length === 0) {
    throw new AccountResolutionError('No Google accounts are authorized yet. Run: sky google:auth')
  }
  if (!requested) {
    if (stored.length === 1) return stored[0]
    throw new AmbiguousAccountError(
      stored,
      `Multiple Google accounts are authorized — pass --account <email or part of it>. Accounts: ${stored.join(', ')}`,
    )
  }
  const exact = stored.find((email) => email === requested)
  if (exact) return exact
  const needle = requested.toLowerCase()
  const matches = stored.filter((email) => email.toLowerCase().includes(needle))
  if (matches.length === 1) return matches[0]
  if (matches.length === 0) {
    throw new AccountResolutionError(
      `No authorized Google account matches "${requested}". Accounts: ${stored.join(', ')}`,
    )
  }
  throw new AmbiguousAccountError(matches, `"${requested}" matches several accounts: ${matches.join(', ')}`)
}

/**
 * The account something new comes from when nobody named one: the only
 * account, else the only work account. Undefined when that is open — no
 * accounts, or several with no single work account among them.
 */
export function defaultAccountEmail(
  stored: string[],
  categoryOf: (email: string) => GoogleAccountCategory,
): string | undefined {
  if (stored.length <= 1) return stored[0]
  const work = stored.filter((email) => categoryOf(email) === 'Professional')
  return work.length === 1 ? work[0] : undefined
}

/**
 * Resolve the account for something new — a draft, a document. A request is
 * matched as resolveAccountEmail matches it; with none, the default account
 * stands in, and only a choice that is still open throws.
 */
export function resolveNewItemAccountEmail(options: {
  requested?: string
  stored: string[]
  categoryOf: (email: string) => GoogleAccountCategory
}): string {
  const { requested, stored, categoryOf } = options
  if (requested || stored.length === 0) return resolveAccountEmail({ requested, stored })
  const chosen = defaultAccountEmail(stored, categoryOf)
  if (chosen) return chosen
  throw new AmbiguousAccountError(
    stored,
    `Several Google accounts could be used and none is the only work account — pass --account <email or part of it>. Accounts: ${stored.join(', ')}`,
  )
}

/**
 * The order to look through accounts for the one that holds something: the
 * requested account, then the default, then the rest as stored. A lookup
 * never has to ask — whichever account can open the thing is the answer.
 */
export function accountLookupOrder(options: {
  requested?: string
  stored: string[]
  categoryOf: (email: string) => GoogleAccountCategory
}): string[] {
  const { requested, stored, categoryOf } = options
  // No accounts, or a request that names none of them, fails as it does everywhere else
  const first = requested || stored.length === 0 ? resolveAccountEmail({ requested, stored }) : undefined
  const fallback = defaultAccountEmail(stored, categoryOf)
  return [...new Set([first, fallback, ...stored].filter((email): email is string => Boolean(email)))]
}

/** Hostnames compare without the `www.` a website usually carries. */
function hostOf(site: string): { host: string; home: boolean } | undefined {
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(site) ? site : `https://${site}`)
    return { host: url.hostname.toLowerCase().replace(/^www\./, ''), home: url.pathname === '/' || url.pathname === '' }
  } catch {
    return undefined
  }
}

/**
 * The organization an account belongs to: the one whose website shares the
 * email's domain. Only a site's home page counts — a profile page on someone
 * else's site (a LinkedIn company page) says nothing about who owns that
 * domain. Two organizations claiming the domain name neither.
 */
export function accountOrg(email: string, orgs: Array<{ name: string; sites: string[] }>): string | undefined {
  const domain = email.trim().toLowerCase().split('@')[1]
  if (!domain) return undefined
  const owners = orgs.filter((org) =>
    org.sites.some((site) => {
      const parsed = hostOf(site)
      if (!parsed?.home) return false
      return parsed.host === domain || domain.endsWith(`.${parsed.host}`) || parsed.host.endsWith(`.${domain}`)
    }),
  )
  return owners.length === 1 ? owners[0].name : undefined
}
