import * as p from '@clack/prompts'
import { unlink } from 'node:fs/promises'
import { DIR_HEARTBEAT_FOLLOW } from '#config'
import { exists } from '#shared/fs/mod.ts'
import FollowRegistry from '#shared/models/Follow/FollowRegistry.ts'
import { createImapClient } from '../lib/imap-client.ts'
import { getInboxThreads } from '../lib/getInboxThreads.ts'
import type { InboxThread } from '../lib/getInboxThreads.ts'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'

const params = {
  account: Flag.string('Account name from secrets (e.g. user@example.com)'),
  label: Flag.string('Gmail label', { default: () => 'Sky/Follow' }),
}

type Params = InferParams<typeof params>
type Result = { closed: string }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'email:inbox:close': { params: Params; result: Result }
  }
}

export default class EmailInboxCloseTask extends Command {
  static override description: CommandDescription = {
    name: 'email:inbox:close',
    description: 'Close an email thread: remove Sky/Follow label, archive from inbox, delete follow.',
    descriptionLong: [
      'Shows a numbered list of threads from email:inbox:view.',
      'Pick a number to close that thread:',
      '  1. Removes the Sky/Follow label from all messages in the thread',
      '  2. Archives all messages from inbox (removes \\Inbox label)',
      '  3. Deletes the follow YAML file',
    ],
    usage: ['sky email:inbox:close --account user@example.com'],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output, secrets } = context
    const { account, label } = args

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

    let threads: InboxThread[]
    try {
      await client.connect()
      const result = await getInboxThreads(client, label)
      threads = result.threads
    } catch (err) {
      return CommandResult.error(err as Error, 'IMAP fetch failed')
    }

    if (threads.length === 0) {
      await client.logout().catch(() => {})
      output.log('  No threads found.\n')
      return CommandResult.fail('No threads to close')
    }

    // Display numbered list
    output.log('')
    for (let i = 0; i < threads.length; i++) {
      const thread = threads[i]
      const first = thread.messages[0]
      const date = first.date ? first.date.toISOString().slice(0, 10) : '(no date)'
      const from = first.from?.name || first.from?.address || '(unknown)'
      const subject = first.subject || '(no subject)'
      const saved = thread.saved ? ' [saved]' : ''
      const replies = thread.messages.length > 1 ? ` (+${thread.messages.length - 1} replies)` : ''
      output.log(`  ${String(i + 1).padStart(2)}.  ${date}  ${from}  —  ${subject}${replies}${saved}`)
    }
    output.log('')

    // Prompt for selection
    const selected = await p.text({
      message: 'Enter number to close (or q to cancel)',
    })

    if (p.isCancel(selected) || selected === 'q') {
      await client.logout().catch(() => {})
      p.cancel('Cancelled')
      return CommandResult.fail('User cancelled')
    }

    const idx = parseInt(selected, 10) - 1
    if (isNaN(idx) || idx < 0 || idx >= threads.length) {
      await client.logout().catch(() => {})
      return CommandResult.fail(`Invalid selection: ${selected}`)
    }

    const thread = threads[idx]
    const threadId = thread.threadId
    const subject = thread.messages[0].subject || '(no subject)'

    output.log(`\n  Closing: ${subject}`)

    try {
      // 1. Find all UIDs for this thread in the label
      const lock = await client.getMailboxLock(label)
      const threadUids: number[] = []
      try {
        const uids = await client.search({ all: true }, { uid: true })
        if (uids && uids.length > 0) {
          const uidRange = uids.join(',')
          for await (const msg of client.fetch(uidRange, { threadId: true }, { uid: true })) {
            if (msg.threadId === threadId) {
              threadUids.push(msg.uid)
            }
          }
        }
      } finally {
        lock.release()
      }

      // 2. Remove Sky/Follow label (delete from label folder = removes label in Gmail)
      if (threadUids.length > 0) {
        const delLock = await client.getMailboxLock(label)
        try {
          await client.messageDelete({ uid: threadUids.join(',') }, { uid: true })
          output.log(`  Removed "${label}" label from ${threadUids.length} message(s).`)
        } finally {
          delLock.release()
        }
      }

      // 3. Archive from inbox (delete from INBOX = archive in Gmail)
      const inboxLock = await client.getMailboxLock('INBOX')
      try {
        const inboxUids: number[] = []
        const uids = await client.search({ all: true }, { uid: true })
        if (uids && uids.length > 0) {
          const uidRange = uids.join(',')
          for await (const msg of client.fetch(uidRange, { threadId: true }, { uid: true })) {
            if (msg.threadId === threadId) {
              inboxUids.push(msg.uid)
            }
          }
        }

        if (inboxUids.length > 0) {
          await client.messageDelete({ uid: inboxUids.join(',') }, { uid: true })
          output.log(`  Archived ${inboxUids.length} message(s) from inbox.`)
        }
      } finally {
        inboxLock.release()
      }
    } catch (err) {
      output.log(`  Warning: IMAP operations failed: ${(err as Error).message}`)
    } finally {
      await client.logout().catch(() => {})
    }

    // 4. Delete the follow YAML if it exists
    if (thread.saved && (await exists(DIR_HEARTBEAT_FOLLOW))) {
      const registry = await FollowRegistry.build(DIR_HEARTBEAT_FOLLOW)
      const followEntry = registry
        .getAll()
        .find((e) => e.follow.source === 'Email' && e.follow.ref.threadId === threadId)
      if (followEntry) {
        await unlink(followEntry.path)
        output.log(`  Deleted follow: ${followEntry.fileName}`)
      }
    }

    output.log(`\n  Closed: ${subject}\n`)
    return CommandResult.success({ closed: subject })
  }
}
