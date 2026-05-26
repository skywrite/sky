import * as path from 'node:path'
import * as p from '@clack/prompts'
import { DIR_STATE_FOLLOW_EMAIL_ACTIVE } from '#config'
import { outputFile } from '#shared/fs/mod.ts'
import { fetchNowSync } from '#shared/nbfs/mod.ts'
import slugify from '#lib/string/slugify.ts'
import Follow from '#shared/models/Follow/mod.ts'
import { createImapClient } from '#commands/all/email/lib/imap-client.ts'
import { getInboxThreads } from '#commands/all/email/lib/getInboxThreads.ts'
import type { InboxThread } from '#commands/all/email/lib/getInboxThreads.ts'
import { PlainDateTime as PDT } from '#universal/dates/nbdt/mod.ts'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'

const params = {
  account: Flag.string('Account name from secrets (e.g. user@example.com)'),
  label: Flag.string('Gmail label', { default: () => 'Sky/Follow' }),
  limit: Flag.number('Max threads to follow', { default: () => 50 }),
  when: Flag.plainDateTime('Collapse all messages to this date', { parse: PDT.fromString }),
}

type Params = InferParams<typeof params>
type Result = { created: number; follows: string[] }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'email:inbox:follow:new': { params: Params; result: Result }
  }
}

export default class FollowEmailNewTask extends Command {
  static override description: CommandDescription = {
    name: 'email:inbox:follow:new',
    description: 'Fetch unsaved emails and create follow files to track them.',
    descriptionLong: [
      'Without --when: fetches ALL unsaved threads and creates follows (batch mode).',
      'With --when: shows a chooser for a single thread, collapses all messages',
      'into one file at the specified date (like follow:slack:new).',
    ],
    usage: [
      'sky email:inbox:follow:new --account user@example.com',
      'sky email:inbox:follow:new --account user@example.com --when 17:00',
    ],
    params,
  }

  async run({ args, context, tasks }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output, secrets } = context
    const { account, label, limit, when } = args

    if (!account) {
      return CommandResult.fail('--account is required')
    }

    if (when) {
      // ── Single-thread mode: chooser + collapse into one file ───────
      return this.runSingleThread(args, context, tasks)
    }

    // ── Batch mode: fetch + follow ALL unsaved threads ─────────────
    const fetchResult = await tasks.run('email:inbox:fetch', { account, label, limit })

    if (!fetchResult.ok || !fetchResult.data) {
      return CommandResult.fail('email:inbox:fetch failed')
    }

    if (fetchResult.data.fetched === 0) {
      output.log('  No unsaved threads to follow.\n')
      return CommandResult.success({ created: 0, follows: [] })
    }

    const result = await this.createFollows(fetchResult.data.threads, args, output)

    // Archive from inbox + remove Sky/Follow label
    const entry = await secrets.get('email', account!)
    if (entry && entry.type === 'login') {
      const threadIds = fetchResult.data.threads.map((t) => t.threadId)
      await this.archiveThreads(threadIds, label, { user: entry.user, pass: entry.pass }, output)
    }

    return result
  }

  private async runSingleThread(
    args: CommandArgs<Params>['args'],
    context: CommandArgs<Params>['context'],
    tasks: CommandArgs<Params>['tasks'],
  ): Promise<CommandResult<Result>> {
    const { output, secrets } = context
    const { account, label, when } = args

    const entry = await secrets.get('email', account!)
    if (!entry || entry.type !== 'login') {
      return CommandResult.fail(`Login credentials not found for email/${account}`)
    }

    // Get threads to find unsaved ones
    output.log(`\n  Connecting to Gmail IMAP as ${entry.user}...`)
    const client = createImapClient({ user: entry.user, pass: entry.pass })
    client.on('error', () => {})

    let unsaved: InboxThread[]
    try {
      await client.connect()
      const { threads } = await getInboxThreads(client, label)
      unsaved = threads.filter((t) => !t.saved)
    } catch (err) {
      return CommandResult.error(err as Error, 'IMAP fetch failed')
    } finally {
      await client.logout().catch(() => {})
    }

    if (unsaved.length === 0) {
      output.log('  No unsaved threads to follow.\n')
      return CommandResult.success({ created: 0, follows: [] })
    }

    // Choose thread
    let selectedThread: InboxThread
    if (unsaved.length === 1) {
      selectedThread = unsaved[0]
      const subject = selectedThread.messages[0].subject || '(no subject)'
      output.log(`  Auto-selected: ${subject}\n`)
    } else {
      output.log('')
      for (let i = 0; i < unsaved.length; i++) {
        const thread = unsaved[i]
        const first = thread.messages[0]
        const date = first.date ? first.date.toISOString().slice(0, 10) : '(no date)'
        const from = first.from?.name || first.from?.address || '(unknown)'
        const subject = first.subject || '(no subject)'
        const replies = thread.messages.length > 1 ? ` (+${thread.messages.length - 1})` : ''
        output.log(`  ${String(i + 1).padStart(2)}.  ${date}  ${from}  —  ${subject}${replies}`)
      }
      output.log('')

      const selected = await p.text({
        message: 'Which thread to follow? (number or q to cancel)',
      })

      if (p.isCancel(selected) || selected === 'q') {
        p.cancel('Cancelled')
        return CommandResult.fail('User cancelled')
      }

      const idx = parseInt(selected, 10) - 1
      if (isNaN(idx) || idx < 0 || idx >= unsaved.length) {
        return CommandResult.fail(`Invalid selection: ${selected}`)
      }
      selectedThread = unsaved[idx]
    }

    // Fetch with --when and --threadId to collapse into one file
    const fetchResult = await tasks.run('email:inbox:fetch', {
      account,
      label,
      when,
      threadId: selectedThread.threadId,
    })

    if (!fetchResult.ok || !fetchResult.data || fetchResult.data.fetched === 0) {
      return CommandResult.fail('email:inbox:fetch failed')
    }

    const result = await this.createFollows(fetchResult.data.threads, args, output)

    // Archive from inbox + remove Sky/Follow label
    await this.archiveThreads([selectedThread.threadId], label, { user: entry.user, pass: entry.pass }, output)

    return result
  }

  private async archiveThreads(
    threadIds: string[],
    _label: string,
    creds: { user: string; pass: string },
    output: { log: (msg: string) => void },
  ): Promise<void> {
    if (threadIds.length === 0) return

    const threadIdSet = new Set(threadIds)
    const client = createImapClient(creds)
    client.on('error', () => {})

    try {
      await client.connect()

      // Archive from inbox only (delete from INBOX = removes \Inbox label)
      // Sky/Follow label stays so email:inbox:view shows it as saved
      const inboxLock = await client.getMailboxLock('INBOX')
      try {
        const uids = await client.search({ all: true }, { uid: true })
        if (uids && uids.length > 0) {
          const toDelete: number[] = []
          const uidRange = uids.join(',')
          for await (const msg of client.fetch(uidRange, { threadId: true }, { uid: true })) {
            if (msg.threadId && threadIdSet.has(msg.threadId)) {
              toDelete.push(msg.uid)
            }
          }
          if (toDelete.length > 0) {
            await client.messageDelete({ uid: toDelete.join(',') }, { uid: true })
            output.log(`  Archived ${toDelete.length} message(s) from inbox.`)
          }
        }
      } finally {
        inboxLock.release()
      }
    } catch (err) {
      output.log(`  Warning: archive failed: ${(err as Error).message}`)
    } finally {
      await client.logout().catch(() => {})
    }
  }

  private async createFollows(
    threads: { threadId: string; from: string; subject: string; messages: { date: string; path: string }[] }[],
    args: CommandArgs<Params>['args'],
    output: { log: (msg: string) => void },
  ): Promise<CommandResult<Result>> {
    const { account, label } = args
    const now = fetchNowSync()
    const created: string[] = []

    for (const thread of threads) {
      if (thread.messages.length === 0) continue

      let follow = Follow.create({
        source: 'Email',
        ref: { account: account!, threadId: thread.threadId, label },
        summary: thread.subject,
        followSince: now.plainDateTime,
        lastActivity: now.plainDateTime,
        messages: [],
        status: 'active',
      })

      for (const msg of thread.messages) {
        follow = follow.addMessage(msg.date, msg.path).updateLastActivity(now.plainDateTime)
      }

      const fromSlug = slugify(thread.from, { preserveCase: true, suggestedLength: 30 })
      const summarySlug = slugify(thread.subject, { preserveCase: true, suggestedLength: 40 })
      const datePrefix = now.plainDateTime.plainDate.toString()
      const fileName = `${datePrefix}_email_${fromSlug}_${summarySlug}`
      const filePath = path.join(DIR_STATE_FOLLOW_EMAIL_ACTIVE, `${fileName}.yaml`)

      await outputFile(filePath, follow.toYaml())
      created.push(fileName)
      output.log(`  Created follow: ${fileName}`)
    }

    output.log(`\n  ${created.length} follow(s) created.\n`)
    return CommandResult.success({ created: created.length, follows: created })
  }
}
