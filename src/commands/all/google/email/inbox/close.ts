import { unlink } from 'node:fs/promises'
import * as path from 'node:path'
import * as p from '@clack/prompts'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { DIR_STATE_FOLLOW_EMAIL_ARCHIVE } from '#config'
import { AccountResolutionError, modifyThread } from '#lib/google/mod.ts'
import { outputFile } from '#shared/fs/mod.ts'
import EmailFollowRegistry from '#shared/models/Follow/EmailFollowRegistry.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { getInboxThreads } from '../lib/getInboxThreads.ts'
import type { InboxThread } from '../lib/getInboxThreads.ts'
import { resolveGmailClient } from '../lib/resolveGmailClient.ts'

const params = {
  account: Flag.string('Google account (email or unique part of it)', { short: 'a' }),
  label: Flag.string('Gmail label', { default: () => 'Sky/Follow' }),
}

type Params = InferParams<typeof params>
type Result = { closed: string }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'google:email:inbox:close': { params: Params; result: Result }
  }
}

export default class GoogleEmailInboxCloseTask extends Command {
  static override description: CommandDescription = {
    name: 'google:email:inbox:close',
    description: 'Close an email thread: remove Sky/Follow label, archive from inbox, archive follow.',
    descriptionLong: [
      'Gmail-API twin of email:inbox:close, using the OAuth grant from google:auth',
      '(requires the Gmail scope). Shows an interactive picker of threads from',
      'google:email:inbox:view. Pick a thread to close it:',
      '  1. Removes the Sky/Follow label from all messages in the thread',
      '  2. Archives all messages from inbox (removes the INBOX label)',
      '  3. Archives the follow YAML (status: closed, moved to follow/email/archive/)',
    ],
    usage: ['sky google:email:inbox:close'],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output, secrets } = context
    const { account, label } = args

    let client
    try {
      client = await resolveGmailClient({ secrets, requested: account, interactive: true })
    } catch (err) {
      if (err instanceof AccountResolutionError) return CommandResult.fail(err.message)
      throw err
    }

    let threads: InboxThread[]
    let labelId: string
    try {
      output.log(`\n  Fetching "${label}" for ${client.email}...`)
      const result = await getInboxThreads(client, label)
      threads = result.threads
      labelId = result.labelId
    } catch (err) {
      return CommandResult.error(err as Error, 'Gmail fetch failed')
    }

    if (threads.length === 0) {
      output.log('  No threads found.\n')
      return CommandResult.fail('No threads to close')
    }

    // Prompt for selection (same picker style as follow:sync --pick)
    const selected = await p.select({
      message: 'Which thread to close?',
      options: threads.map((t) => {
        const first = t.messages[0]
        // Messages are sorted oldest-first, so the last one is the most recent
        const latest = t.messages.at(-1)
        const date = latest?.date ? PlainDate.from(latest.date).toString() : undefined
        const subject = first?.subject || '(no subject)'
        const from = first?.from?.name || first?.from?.address || '(unknown)'
        const count = t.messages.length
        return {
          value: t.threadId,
          label: date ? `[${date}] ${subject}` : subject,
          hint: `${from} · ${count} msg${count === 1 ? '' : 's'} · ${t.saved ? 'saved' : 'unsaved'}`,
        }
      }),
    })

    if (p.isCancel(selected)) {
      p.cancel('Cancelled')
      return CommandResult.fail('User cancelled')
    }

    const thread = threads.find((t) => t.threadId === selected)!
    const threadId = thread.threadId
    const subject = thread.messages[0].subject || '(no subject)'

    output.log(`\n  Closing: ${subject}`)

    // One thread-level modify replaces the IMAP original's three full-mailbox
    // scans: unlabel + archive every message of the thread in a single call.
    try {
      await modifyThread(client, thread.apiThreadId, { removeLabelIds: [labelId, 'INBOX'] })
      output.log(`  Removed "${label}" label and archived ${thread.messages.length} message(s).`)
    } catch (err) {
      output.log(`  Warning: Gmail operations failed: ${(err as Error).message}`)
    }

    // Archive the follow YAML if it exists: mark closed, move out of active/
    // (even when the thread has unsaved replies — closing means stop following)
    const registry = await EmailFollowRegistry.build()
    const followEntry = registry.findByThreadId(threadId)
    if (followEntry) {
      const closed = followEntry.follow.updateStatus('closed')
      await outputFile(path.join(DIR_STATE_FOLLOW_EMAIL_ARCHIVE, followEntry.fileName), closed.toYaml())
      await unlink(followEntry.path)
      output.log(`  Archived follow: ${followEntry.fileName}`)
    }

    output.log(`\n  Closed: ${subject}\n`)
    return CommandResult.success({ closed: subject })
  }
}
