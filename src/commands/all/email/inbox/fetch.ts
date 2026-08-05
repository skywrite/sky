import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { PlainDateTime as PDT } from '#universal/dates/nbdt/mod.ts'
import { fetchUnsavedThreads } from '../lib/fetchUnsavedThreads.ts'
import type { FetchUnsavedResult } from '../lib/fetchUnsavedThreads.ts'
import { createImapClient } from '../lib/imap-client.ts'

export type { FetchedThread } from '../lib/fetchUnsavedThreads.ts'

const params = {
  account: Flag.string('Account name from secrets (e.g. user@example.com)'),
  label: Flag.string('Gmail label to fetch from', { default: () => 'Sky/Follow' }),
  limit: Flag.number('Max new messages to fetch', { default: () => 250 }),
  when: Flag.plainDateTime('Collapse all messages to this date', { parse: PDT.fromString }),
  threadId: Flag.string('Fetch a specific thread by ID', { hidden: true }),
  collapseNewThreads: Flag.boolean('Collapse first-time (unfollowed) threads into one file dated today', {
    default: false,
    hidden: true,
  }),
}

type Params = InferParams<typeof params>

type FetchResult = FetchUnsavedResult

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'email:inbox:fetch': { params: Params; result: FetchResult }
  }
}

export default class EmailInboxFetchTask extends Command {
  static override description: CommandDescription = {
    name: 'email:inbox:fetch',
    description: 'Download unsaved email messages and save to day files.',
    descriptionLong: [
      'Uses email:inbox:view logic to find all threads, identifies unsaved ones,',
      'downloads body content + attachments, and saves to day files.',
      'Same-day messages for a thread are appended to a single file.',
    ],
    usage: [
      'sky email:inbox:fetch --account user@example.com',
      'sky email:inbox:fetch --account user@example.com --limit 5',
    ],
    params,
  }

  async run({ args, context, tasks }: CommandArgs<Params>): Promise<CommandResult<FetchResult>> {
    const { output, secrets } = context
    const { account, label, limit, when, threadId, collapseNewThreads } = args

    if (!account) {
      return CommandResult.fail('--account is required')
    }

    const entry = await secrets.get('email', account)
    if (!entry || entry.type !== 'login') {
      return CommandResult.fail(
        `Login credentials not found for email/${account}. Set them with:\n  sky secrets:set email ${account}`,
      )
    }

    output.log(`\n  Connecting to Gmail IMAP as ${entry.user}...`)
    const client = createImapClient({ user: entry.user, pass: entry.pass })
    client.on('error', () => {})

    try {
      await client.connect()
      const result = await fetchUnsavedThreads(
        client,
        { label, limit, when, threadId, collapseNewThreads },
        { tasks, output },
      )
      return CommandResult.success(result)
    } catch (err) {
      return CommandResult.error(err as Error, 'IMAP fetch failed')
    } finally {
      await client.logout().catch(() => {})
    }
  }
}
