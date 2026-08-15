import type { CommandService } from '#commands/mod.ts'
import { hasGmailScope, listAccountEmails, loadAccountTokens, loadOAuthClient } from '#lib/google/mod.ts'
import type { StoredTokens } from '#lib/google/mod.ts'
import type { SecretsProvider } from '#lib/secrets/SecretsProvider.ts'

// Driving google:email:inbox:follow:sync across every authorized account, for
// callers with no one to prompt — the heartbeat, above all. The sync command
// resolves one account and asks which when several are stored; here the answer
// is always "all of them", so accounts are named explicitly and a grant that
// cannot sync is skipped rather than raised.

/**
 * Threads per account per run. The heartbeat runs one job at a time, so an
 * unbounded first drain of a long-neglected bucket would hold the tick — and
 * the Slack follow check that shares it — for as long as the drain takes.
 * A bounded run leaves the backlog to drain over successive ticks instead.
 */
export const HEARTBEAT_THREAD_LIMIT = 25

export type AccountGrant = { email: string; tokens: StoredTokens | null }

export type SkippedAccount = { account: string; reason: string }

/**
 * Split stored accounts into the ones a Gmail sync can run under and the ones
 * it cannot. A grant issued before the Gmail scope existed is skipped, not an
 * error: the other accounts still sync, and the fix is a google:auth re-run
 * only the owner can perform.
 */
export function selectSyncableAccounts(grants: AccountGrant[]): {
  runnable: string[]
  skipped: SkippedAccount[]
} {
  const runnable: string[] = []
  const skipped: SkippedAccount[] = []
  for (const { email, tokens } of grants) {
    if (!tokens) skipped.push({ account: email, reason: 'no stored grant' })
    else if (!hasGmailScope(tokens)) skipped.push({ account: email, reason: 'grant lacks the Gmail scope' })
    else runnable.push(email)
  }
  return { runnable, skipped }
}

export type AccountSync = {
  account: string
  newFollows: number
  updatedFollows: number
  bornExpired: number
  expired: number
  fetchedMessages: number
  /** The sync failed for this account; the others still ran. */
  error?: string
}

export type GmailSyncSweep = {
  ran: AccountSync[]
  skipped: SkippedAccount[]
  /** Nothing could run at all — no OAuth client, or no accounts stored. Not an error; nothing to do. */
  unavailable?: string
}

/** Every count across the accounts that ran, for one wide log line. */
export function sweepTotals(sweep: GmailSyncSweep): {
  newFollows: number
  updatedFollows: number
  bornExpired: number
  expired: number
  fetchedMessages: number
  errors: number
} {
  const sum = (pick: (a: AccountSync) => number) => sweep.ran.reduce((n, a) => n + pick(a), 0)
  return {
    newFollows: sum((a) => a.newFollows),
    updatedFollows: sum((a) => a.updatedFollows),
    bornExpired: sum((a) => a.bornExpired),
    expired: sum((a) => a.expired),
    fetchedMessages: sum((a) => a.fetchedMessages),
    errors: sweep.ran.filter((a) => a.error).length,
  }
}

/**
 * Sync followed email threads for every account whose grant allows it.
 *
 * Accounts run in sequence: each one's capture is several model calls per new
 * thread, and running mailboxes concurrently would multiply that against the
 * same rate limits. One account's failure is recorded and the rest continue —
 * a revoked grant on a secondary account must not stop the primary from
 * syncing. Never throws.
 */
export async function syncGmailFollowAccounts(opts: {
  secrets: SecretsProvider
  tasks: CommandService
  label?: string
  limit?: number
}): Promise<GmailSyncSweep> {
  const { secrets, tasks, label, limit = HEARTBEAT_THREAD_LIMIT } = opts

  const oauthClient = await loadOAuthClient(secrets)
  if (!oauthClient) return { ran: [], skipped: [], unavailable: 'no Google OAuth client stored' }

  const emails = await listAccountEmails(secrets)
  if (emails.length === 0) return { ran: [], skipped: [], unavailable: 'no Google accounts authorized' }

  const grants: AccountGrant[] = []
  for (const email of emails) grants.push({ email, tokens: await loadAccountTokens(secrets, email) })
  const { runnable, skipped } = selectSyncableAccounts(grants)

  const ran: AccountSync[] = []
  for (const account of runnable) {
    const empty = { account, newFollows: 0, updatedFollows: 0, bornExpired: 0, expired: 0, fetchedMessages: 0 }
    try {
      const result = await tasks.run('google:email:inbox:follow:sync', {
        account,
        limit,
        ...(label ? { label } : {}),
      })
      const data = result.data
      if (!result.ok || !data) {
        ran.push({ ...empty, error: result.message ?? 'sync failed' })
        continue
      }
      ran.push({
        account,
        newFollows: data.newFollows,
        updatedFollows: data.updatedFollows,
        bornExpired: data.bornExpired,
        expired: data.expired.length,
        fetchedMessages: data.fetchedMessages,
      })
    } catch (err) {
      ran.push({ ...empty, error: err instanceof Error ? err.message : String(err) })
    }
  }

  return { ran, skipped }
}
