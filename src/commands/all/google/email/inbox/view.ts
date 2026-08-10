import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { AccountResolutionError, listLabels } from '#lib/google/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { getInboxThreads } from '../lib/getInboxThreads.ts'
import type { InboxThread } from '../lib/getInboxThreads.ts'
import { resolveGmailClient } from '../lib/resolveGmailClient.ts'

const params = {
  account: Flag.string('Google account (email or unique part of it)', { short: 'a' }),
  label: Flag.string('Gmail label to read', { default: () => 'Sky/Follow' }),
  limit: Flag.number('Max threads to fetch', { default: () => 250 }),
}

type Params = InferParams<typeof params>
type Result = { count: number; label: string }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'google:email:inbox:view': { params: Params; result: Result }
  }
}

export default class GoogleEmailInboxViewTask extends Command {
  static override description: CommandDescription = {
    name: 'google:email:inbox:view',
    description: 'List emails in a Gmail label with their labels, sender, subject, and date.',
    descriptionLong: [
      'Gmail-API twin of email:inbox:view, using the OAuth grant from google:auth',
      '(requires the Gmail scope). Shows a compact summary of threads in the',
      'specified label (default: Sky/Follow). Threads with follows on disk are',
      'dimmed (saved), others are bright (unsaved).',
    ],
    usage: ['sky google:email:inbox:view', 'sky google:email:inbox:view --label INBOX --limit 20'],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output, secrets } = context
    const { account, label, limit } = args

    let client
    try {
      client = await resolveGmailClient({ secrets, requested: account, interactive: true })
    } catch (err) {
      if (err instanceof AccountResolutionError) return CommandResult.fail(err.message)
      throw err
    }

    try {
      output.log(`\n  Fetching "${label}" for ${client.email} (limit: ${limit})...\n`)

      const { threads, savedCount, labelId } = await getInboxThreads(client, label, { limit })

      if (threads.length === 0) {
        output.log('  No messages found.\n')
        return CommandResult.success({ count: 0, label })
      }

      const labelNames = new Map((await listLabels(client)).map((l) => [l.id, l.name]))
      const msgCount = outputTable(output, threads, labelId, labelNames)

      const savedStr = savedCount > 0 ? `, ${savedCount} saved` : ''
      output.log(`\n  ${msgCount} message(s) in ${threads.length} thread(s)${savedStr}\n`)
      return CommandResult.success({ count: msgCount, label })
    } catch (err) {
      return CommandResult.error(err as Error, 'Gmail fetch failed')
    }
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
