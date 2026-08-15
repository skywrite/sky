import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { AccountResolutionError } from '#lib/google/mod.ts'
import { PlainDateTime as PDT } from '#universal/dates/nbdt/mod.ts'
import { fetchUnsavedThreads } from '../lib/fetchUnsavedThreads.ts'
import type { FetchUnsavedResult } from '../lib/fetchUnsavedThreads.ts'
import { resolveGmailClient } from '../lib/resolveGmailClient.ts'

export type { FetchedThread } from '../lib/fetchUnsavedThreads.ts'

const params = {
  account: Flag.string('Google account (email or unique part of it)', { short: 'a' }),
  label: Flag.string('Gmail label to fetch from', { default: () => 'Sky/Follow' }),
  limit: Flag.number('Max unsaved threads to capture per run', { default: () => 250 }),
  when: Flag.plainDateTime('Collapse all messages to this date', { parse: PDT.fromString }),
  threadId: Flag.string('Fetch a specific thread by its decimal ID', { hidden: true }),
  follow: Flag.bool('Stamp captures with their follow file name (set by follow:new)', { hidden: true, default: false }),
  noAutoTag: Flag.bool('Skip automatic tagging from the archived-email tag corpus', { default: false }),
  noAutoRel: Flag.bool('Skip automatic rel suggestion from the entity graph', { default: false }),
}

type Params = InferParams<typeof params>

type FetchResult = FetchUnsavedResult

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'google:email:inbox:fetch': { params: Params; result: FetchResult }
  }
}

export default class GoogleEmailInboxFetchTask extends Command {
  static override description: CommandDescription = {
    name: 'google:email:inbox:fetch',
    description: 'Download unsaved email messages via the Gmail API and save to day files.',
    descriptionLong: [
      'Gmail-API twin of email:inbox:fetch, using the OAuth grant from google:auth',
      '(requires the Gmail scope). Uses google:email:inbox:view logic to find all',
      'threads, identifies unsaved ones, downloads body content + attachments,',
      'and saves to day files. Same-day messages for a thread are appended to a',
      'single file. A thread captured for the first time is summarized, tagged,',
      'and related from the archived-email corpus; its later messages inherit',
      'those, so one thread reads as one conversation.',
    ],
    usage: ['sky google:email:inbox:fetch', 'sky google:email:inbox:fetch --limit 5'],
    params,
  }

  async run({ args, context, tasks }: CommandArgs<Params>): Promise<CommandResult<FetchResult>> {
    const { output, secrets } = context
    const { account, label, limit, when, threadId, follow, noAutoTag, noAutoRel } = args

    let client
    try {
      client = await resolveGmailClient({ secrets, requested: account, interactive: true })
    } catch (err) {
      if (err instanceof AccountResolutionError) return CommandResult.fail(err.message)
      throw err
    }

    try {
      output.log(`\n  Fetching "${label}" for ${client.email}...`)
      const result = await fetchUnsavedThreads(
        client,
        { label, limit, when, threadId, follow, noAutoTag, noAutoRel },
        { tasks, output },
      )
      return CommandResult.success(result)
    } catch (err) {
      return CommandResult.error(err as Error, 'Gmail fetch failed')
    }
  }
}
