import { unlink } from 'node:fs/promises'
import * as path from 'node:path'
import * as p from '@clack/prompts'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { AccountResolutionError } from '#lib/google/mod.ts'
import { outputFile } from '#shared/fs/mod.ts'
import EmailFollowRegistry from '#shared/models/Follow/EmailFollowRegistry.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { retireGmailThread } from '../lib/followLabels.ts'
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
    description: 'Close an email thread: mark saved history Sky/Archived, archive from inbox, archive follow.',
    descriptionLong: [
      'Gmail-API twin of email:inbox:close, using the OAuth grant from google:auth',
      '(requires the Gmail scope). Shows an interactive picker of threads from',
      'google:email:inbox:view. Pick a thread to close it:',
      '  1. Replaces Sky/Follow with Sky/Archived when the thread has saved history',
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
    try {
      output.log(`\n  Fetching "${label}" for ${client.email}...`)
      const result = await getInboxThreads(client, label, {
        followDir: context.config.DIR_STATE_FOLLOW_EMAIL_ACTIVE,
        followArchiveDir: context.config.DIR_STATE_FOLLOW_EMAIL_ARCHIVE,
        timeDir: context.config.DIR_TIME,
      })
      threads = result.threads
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

    const registry = await EmailFollowRegistry.buildWithArchive(
      context.config.DIR_STATE_FOLLOW_EMAIL_ACTIVE,
      context.config.DIR_STATE_FOLLOW_EMAIL_ARCHIVE,
    )
    const followEntry = registry.findByThreadId(threadId, client.email)

    // One thread-level modify replaces the IMAP original's three full-mailbox
    // scans: unlabel + archive every message of the thread in a single call.
    try {
      await retireGmailThread({
        client,
        threadId: thread.apiThreadId,
        label,
        saved: !!followEntry?.follow.messages.length,
      })
      output.log(`  Removed "${label}" label and archived ${thread.messages.length} message(s).`)
    } catch (err) {
      return CommandResult.error(err as Error, 'Gmail close failed; follow history retained')
    }

    // Archive the follow YAML if it exists: mark closed, move out of active/
    // (even when the thread has unsaved replies — closing means stop following)
    if (followEntry) {
      const closed = followEntry.follow.updateStatus('closed')
      const destination = path.join(context.config.DIR_STATE_FOLLOW_EMAIL_ARCHIVE, `${followEntry.fileName}.yaml`)
      await outputFile(destination, closed.toYaml())
      if (followEntry.path !== destination) await unlink(followEntry.path)
      output.log(`  Archived follow: ${followEntry.fileName}`)
    }

    output.log(`\n  Closed: ${subject}\n`)
    return CommandResult.success({ closed: subject })
  }
}
