import { z } from 'zod'
import { AIChatTool } from '#commands/lib/AIChatTool.ts'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { AccountResolutionError, getLabelCounts, listLabels } from '#lib/google/mod.ts'
import type { GmailLabelCounts } from '#lib/google/mod.ts'
import { Instant, PlainDate } from '#universal/dates/nbdt/mod.ts'
import { GmailLabelNotFoundError, getInboxThreads } from '../lib/getInboxThreads.ts'
import type { InboxThread } from '../lib/getInboxThreads.ts'
import { gmailClientsToList } from '../lib/resolveGmailClient.ts'

const params = {
  account: Flag.string(
    'Limit the listing to one Google account (email or unique part of it); left out, every connected account',
    { short: 'a' },
  ),
  label: Flag.string('Gmail label to read', { default: () => 'Sky/Follow' }),
  limit: Flag.number('Max threads to fetch from each account', {
    default: () => 250,
    schema: z.coerce.number().int().positive(),
  }),
}

type Params = InferParams<typeof params>

/** One thread as the tool reports it — enough to say it aloud and act on it. */
interface ViewThreadRow {
  /** Gmail API thread id — pass to google:email:read and google:email:draft:reply. */
  threadId: string
  /** The mailbox the thread is in */
  account: string
  subject: string
  from: string
  /** Newest message time, ISO. */
  date?: string
  snippet?: string
  messages: number
  saved: boolean
  followStatus?: InboxThread['followStatus']
}

/** One mailbox's share of the listing. */
interface ViewAccount {
  account: string
  /** Threads listed from this mailbox */
  threads: number
  /** Messages in those threads */
  count: number
  /** The label's true counts in this mailbox; null when they could not be retrieved */
  totals: GmailLabelCounts | null
  /** Set when this mailbox has no label of that name — it holds nothing under it */
  labelMissing?: true
  /** Why this mailbox could not be read; its mail is absent from the listing */
  error?: string
}

type Result = {
  count: number
  label: string
  threads: ViewThreadRow[]
  /** The label's true counts over every mailbox listed; null when any of them is unknown */
  totals: GmailLabelCounts | null
  accounts: ViewAccount[]
}

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'google:email:inbox:view': { params: Params; result: Result }
  }
}

const NO_MAIL: GmailLabelCounts = { threadsTotal: 0, messagesTotal: 0, threadsUnread: 0, messagesUnread: 0 }

/** Counts over several mailboxes; unknown as soon as one mailbox's are. */
function sumTotals(all: Array<GmailLabelCounts | null>): GmailLabelCounts | null {
  let sum = NO_MAIL
  for (const totals of all) {
    if (!totals) return null
    sum = {
      threadsTotal: sum.threadsTotal + totals.threadsTotal,
      messagesTotal: sum.messagesTotal + totals.messagesTotal,
      threadsUnread: sum.threadsUnread + totals.threadsUnread,
      messagesUnread: sum.messagesUnread + totals.messagesUnread,
    }
  }
  return sum
}

@AIChatTool({ needsApproval: false })
export default class GoogleEmailInboxViewTask extends Command {
  static override description: CommandDescription = {
    name: 'google:email:inbox:view',
    description:
      'List Gmail threads in a label, newest first: sender, subject, date, snippet, and the threadId that ' +
      'google:email:read and google:email:draft:reply take. label INBOX is the inbox, UNREAD is unread mail; ' +
      'the default is the Sky/Follow bucket. Every connected account is listed unless `account` names one; ' +
      "each thread says which `account` it is in. `totals` carries the label's true thread and message counts " +
      'over the accounts listed, and `accounts` breaks them down by account — answer "how many" from totals, ' +
      'never from the number of listed threads. A null totals means the total could not be retrieved; an ' +
      'account with an `error` could not be read, so say its mail is missing. Changes nothing.',
    descriptionLong: [
      'Gmail-API twin of email:inbox:view, using the OAuth grant from google:auth',
      '(requires the Gmail scope). Shows a compact summary of threads in the',
      'specified label (default: Sky/Follow) for every connected account, or the',
      'one --account names. Threads with follows on disk are dimmed (saved),',
      'others are bright (unsaved).',
    ],
    usage: [
      'sky google:email:inbox:view',
      'sky google:email:inbox:view --label INBOX --limit 20',
      'sky google:email:inbox:view --label INBOX -a work',
    ],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output, secrets } = context
    const { account, label, limit } = args

    // A listing covers every mailbox unless one is named: nobody is asked which.
    let listing
    try {
      listing = await gmailClientsToList({ secrets, requested: account })
    } catch (err) {
      if (err instanceof AccountResolutionError) return CommandResult.fail(err.message)
      throw err
    }
    const { clients } = listing

    const accounts: ViewAccount[] = listing.skipped.map(({ account: email, reason }) => ({
      account: email,
      threads: 0,
      count: 0,
      totals: null,
      error: reason,
    }))
    const rows: Array<{ at: number; row: ViewThreadRow }> = []
    let savedCount = 0
    let read = 0
    let failure: unknown

    for (const client of clients) {
      try {
        output.log(`\n  Fetching "${label}" for ${client.email} (limit: ${limit})...\n`)

        const {
          threads,
          savedCount: saved,
          labelId,
        } = await getInboxThreads(client, label, {
          limit,
          syncLabels: false,
          followDir: context.config.DIR_STATE_FOLLOW_EMAIL_ACTIVE,
          followArchiveDir: context.config.DIR_STATE_FOLLOW_EMAIL_ARCHIVE,
          timeDir: context.config.DIR_TIME,
        })

        const totals = await getLabelCounts(client, labelId).catch(() => null)

        if (threads.length === 0) {
          output.log('  No messages found.\n')
          accounts.push({ account: client.email, threads: 0, count: 0, totals })
          read++
          continue
        }

        const labelNames = new Map((await listLabels(client)).map((l) => [l.id, l.name]))
        const count = outputTable(output, threads, labelId, labelNames)
        savedCount += saved
        read++

        for (const t of threads) {
          const newest = t.messages[t.messages.length - 1]
          const first = t.messages[0]
          const timestamp = newest.date ? Instant.fromEpochMilliseconds(Number(newest.date)) : undefined
          rows.push({
            at: timestamp?.epochMilliseconds ?? 0,
            row: {
              threadId: t.apiThreadId,
              account: client.email,
              subject: first.subject || '(no subject)',
              from: newest.from?.name || newest.from?.address || '(unknown)',
              date: timestamp?.toString({ smallestUnit: 'millisecond' }),
              snippet: newest.snippet,
              messages: t.messages.length,
              saved: t.saved,
              ...(t.followStatus ? { followStatus: t.followStatus } : {}),
            },
          })
        }
        accounts.push({ account: client.email, threads: threads.length, count, totals })
      } catch (err) {
        // One mailbox must not hide the others: a mailbox without the label holds nothing under it, and one that
        // cannot be read is reported as missing from the listing.
        if (err instanceof GmailLabelNotFoundError && clients.length > 1) {
          output.log(`  No "${label}" label in ${client.email}.\n`)
          accounts.push({ account: client.email, threads: 0, count: 0, totals: NO_MAIL, labelMissing: true })
          continue
        }
        failure ??= err
        const reason = err instanceof Error ? err.message : String(err)
        if (clients.length > 1) output.log(`  Could not read ${client.email}: ${reason}\n`)
        accounts.push({ account: client.email, threads: 0, count: 0, totals: null, error: reason })
      }
    }

    // Nothing could be listed anywhere: that is the failure a single mailbox always reported.
    if (read === 0) {
      if (failure) return CommandResult.error(failure as Error, 'Gmail fetch failed')
      return CommandResult.fail(`Gmail label "${label}" not found in ${clients.map((c) => c.email).join(' or ')}`)
    }

    // Newest first across mailboxes; a sort that keeps each mailbox's own order for equal times.
    rows.sort((a, b) => b.at - a.at)
    const threads = rows.map(({ row }) => row)
    const count = accounts.reduce((sum, entry) => sum + entry.count, 0)
    const totals = sumTotals(accounts.map((entry) => entry.totals))

    if (threads.length > 0 || clients.length > 1) {
      const savedStr = savedCount > 0 ? `, ${savedCount} saved` : ''
      const totalStr = totals
        ? ` — label total: ${totals.threadsTotal} thread(s), ${totals.messagesTotal} message(s)`
        : ''
      const where = clients.length > 1 ? ` across ${clients.map((c) => c.email).join(', ')}` : ''
      output.log(`\n  ${count} message(s) in ${threads.length} thread(s)${where}${savedStr}${totalStr}\n`)
    }
    return CommandResult.success({ count, label, threads, totals, accounts })
  }
}

const DIM = '\x1b[2m'
const RESET = '\x1b[0m'

function outputTable(
  output: { log: (msg: string) => void },
  threads: InboxThread[],
  currentLabelId: string,
  labelNames: Map<string, string>,
): number {
  let msgCount = 0

  for (const thread of threads) {
    const first = thread.messages[0]
    const dim = first.saved ? DIM : ''
    const reset = first.saved ? RESET : ''

    const date = first.date ? PlainDate.from(first.date).toString() : '(no date) '
    const from = truncate(first.from?.name || first.from?.address || '(unknown)', 28)
    const subject = truncate(first.subject || '(no subject)', 50)

    const otherLabels = first.labelIds
      .filter((id) => id !== currentLabelId)
      .map((id) => formatLabel(id, labelNames))
      .filter(Boolean)
      .join(', ')
    const labelsStr = otherLabels ? `  [${otherLabels}]` : ''

    output.log(`${dim}  ${date}  ${from.padEnd(28)}  ${subject}${labelsStr}${reset}`)
    msgCount++

    for (let i = 1; i < thread.messages.length; i++) {
      const reply = thread.messages[i]
      const rd = reply.saved ? DIM : ''
      const rr = reply.saved ? RESET : ''
      const replyDate = reply.date ? PlainDate.from(reply.date).toString() : '(no date) '
      const replyFrom = truncate(reply.from?.name || reply.from?.address || '(unknown)', 28)
      output.log(`${rd}      ${replyDate}  ${replyFrom}${rr}`)
      msgCount++
    }
  }

  return msgCount
}

/** Render a Gmail label id for display; '' drops it as noise. */
function formatLabel(id: string, labelNames: Map<string, string>): string {
  if (id === 'UNREAD' || id.startsWith('CATEGORY_')) return ''
  switch (id) {
    case 'INBOX':
      return 'Inbox'
    case 'SENT':
      return 'Sent'
    case 'DRAFT':
      return 'Draft'
    case 'STARRED':
      return 'Starred'
    case 'IMPORTANT':
      return 'Important'
    case 'TRASH':
      return 'Trash'
    case 'SPAM':
      return 'Spam'
    default:
      return labelNames.get(id) ?? id
  }
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max - 1) + '…' : str
}
