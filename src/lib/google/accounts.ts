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
