import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { getInboxThreads } from '../lib/getInboxThreads.ts'
import type { InboxThread } from '../lib/getInboxThreads.ts'
import { createImapClient } from '../lib/imap-client.ts'

const params = {
  account: Flag.string('Account name from secrets (e.g. personal, work)'),
  label: Flag.string('Gmail label / IMAP folder to read', { default: () => 'Sky/Follow' }),
  limit: Flag.number('Max messages to fetch', { default: () => 250 }),
  since: Flag.string('Only fetch messages since this date (YYYY-MM-DD)'),
  debug: Flag.boolean('Show debug info for message discovery'),
}

type Params = InferParams<typeof params>
type Result = { count: number; label: string }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'email:inbox:view': { params: Params; result: Result }
  }
}

export default class EmailInboxViewTask extends Command {
  static override description: CommandDescription = {
    name: 'email:inbox:view',
    description: 'List emails in a Gmail label with their labels, sender, subject, and date.',
    descriptionLong: [
      'Connects to Gmail IMAP using credentials from OS keychain.',
      'Store credentials with: sky secrets:set email <account-name>',
      'Shows a compact summary of emails in the specified label (default: Sky/Follow).',
      'Threads with follows on disk are dimmed (saved), others are bright (unsaved).',
    ],
    usage: [
      'sky email:inbox:view --account user@example.com',
      'sky email:inbox:view --account personal --label "INBOX" --limit 20',
    ],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output, secrets } = context
    const { account, label, limit, since: sinceStr, debug } = args

    if (!account) {
      return CommandResult.fail(
        '--account is required (e.g. --account personal). Store credentials with: sky secrets:set email <name>',
      )
    }

    const entry = await secrets.get('email', account)
    if (!entry || entry.type !== 'login') {
      return CommandResult.fail(
        `Login credentials not found for email/${account}. Set them with:\n` + `  sky secrets:set email ${account}`,
      )
    }

    // Parse since as PlainDate, convert to JS Date at IMAP boundary
    const sincePlain = sinceStr ? PlainDate.fromString(sinceStr) : undefined
    const sinceDate = sincePlain ? new Date(sincePlain.year, sincePlain.month - 1, sincePlain.day) : undefined

    output.log(`\n  Connecting to Gmail IMAP as ${entry.user}...`)

    const client = createImapClient({ user: entry.user, pass: entry.pass })
    client.on('error', () => {})

    try {
      await client.connect()
      output.log(`  Connected. Fetching from "${label}" (limit: ${limit})...\n`)

      const { threads, savedCount, unsavedCount } = await getInboxThreads(client, label, {
        since: sinceDate,
        limit,
        debug,
      })

      if (threads.length === 0) {
        output.log('  No messages found.\n')
        return CommandResult.success({ count: 0, label })
      }

      const msgCount = outputTable(output, threads, label)

      const savedStr = savedCount > 0 ? `, ${savedCount} saved` : ''
      output.log(`\n  ${msgCount} message(s) in ${threads.length} thread(s)${savedStr}\n`)
      return CommandResult.success({ count: msgCount, label })
    } catch (err) {
      return CommandResult.error(err as Error, 'IMAP fetch failed')
    } finally {
      await client.logout().catch(() => {})
    }
  }
}

const DIM = '\x1b[2m'
const RESET = '\x1b[0m'

function outputTable(output: { log: (msg: string) => void }, threads: InboxThread[], currentLabel: string): number {
  let msgCount = 0

  for (const thread of threads) {
    const first = thread.messages[0]
    const dim = first.saved ? DIM : ''
    const reset = first.saved ? RESET : ''

    const date = first.date ? PlainDate.from(first.date).toString() : '(no date) '
    const from = truncate(first.from?.name || first.from?.address || '(unknown)', 28)
    const subject = truncate(first.subject || '(no subject)', 50)

    const otherLabels = (first.labels ?? [])
      .filter((l) => l !== currentLabel)
      .map(formatLabel)
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

/** Shorten Gmail system labels for readability */
function formatLabel(label: string): string {
  if (label === '\\Inbox') return 'Inbox'
  if (label === '\\Sent') return 'Sent'
  if (label === '\\Draft') return 'Draft'
  if (label === '\\Starred') return 'Starred'
  if (label === '\\Important') return 'Important'
  if (label === '\\Trash') return 'Trash'
  if (label === '\\Spam') return 'Spam'
  return label
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max - 1) + '…' : str
}
