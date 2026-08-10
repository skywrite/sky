import * as path from 'node:path'
import * as p from '@clack/prompts'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { DIR_STATE_FOLLOW_EMAIL_ACTIVE } from '#config'
import { AccountResolutionError, modifyThread, threadIdFromDecimal } from '#lib/google/mod.ts'
import type { GoogleClient } from '#lib/google/mod.ts'
import slugify from '#lib/string/slugify.ts'
import { outputFile } from '#shared/fs/mod.ts'
import Follow from '#shared/models/Follow/mod.ts'
import { fetchNowSync } from '#shared/nbfs/mod.ts'
import { PlainDateTime as PDT } from '#universal/dates/nbdt/mod.ts'
import { getInboxThreads } from '../../lib/getInboxThreads.ts'
import type { InboxThread } from '../../lib/getInboxThreads.ts'
import { resolveGmailClient } from '../../lib/resolveGmailClient.ts'

const params = {
  account: Flag.string('Google account (email or unique part of it)', { short: 'a' }),
  label: Flag.string('Gmail label', { default: () => 'Sky/Follow' }),
  limit: Flag.number('Max threads to follow', { default: () => 250 }),
  when: Flag.plainDateTime('Collapse all messages to this date', { parse: PDT.fromString }),
}

type Params = InferParams<typeof params>
type Result = { created: number; follows: string[] }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'google:email:inbox:follow:new': { params: Params; result: Result }
  }
}

export default class GoogleEmailInboxFollowNewTask extends Command {
  static override description: CommandDescription = {
    name: 'google:email:inbox:follow:new',
    description: 'Fetch unsaved emails via the Gmail API and create follow files to track them.',
    descriptionLong: [
      'Gmail-API twin of email:inbox:follow:new, using the OAuth grant from',
      'google:auth (requires the Gmail scope).',
      'Without --when: fetches ALL unsaved threads and creates follows (batch mode).',
      'With --when: shows a chooser for a single thread, collapses all messages',
      'into one file at the specified date (like slack:follow:new).',
    ],
    usage: ['sky google:email:inbox:follow:new', 'sky google:email:inbox:follow:new --when 17:00'],
    params,
  }

  async run({ args, context, tasks }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output, secrets } = context
    const { account, label, limit, when } = args

    let client: GoogleClient
    try {
      client = await resolveGmailClient({ secrets, requested: account, interactive: true })
    } catch (err) {
      if (err instanceof AccountResolutionError) return CommandResult.fail(err.message)
      throw err
    }

    if (when) {
      // ── Single-thread mode: chooser + collapse into one file ───────
      return this.runSingleThread(client, args, output, tasks)
    }

    // ── Batch mode: fetch + follow ALL unsaved threads ─────────────
    const fetchResult = await tasks.run('google:email:inbox:fetch', { account, label, limit })

    if (!fetchResult.ok || !fetchResult.data) {
      return CommandResult.fail('google:email:inbox:fetch failed')
    }

    if (fetchResult.data.fetched === 0) {
      output.log('  No unsaved threads to follow.\n')
      return CommandResult.success({ created: 0, follows: [] })
    }

    const result = await this.createFollows(client, fetchResult.data.threads, label, output)

    // Archive from inbox; the Sky/Follow label stays so inbox:view shows the
    // thread as saved.
    const threadIds = fetchResult.data.threads.map((t) => t.threadId)
    await this.archiveThreads(client, threadIds, output)

    return result
  }

  private async runSingleThread(
    client: GoogleClient,
    args: CommandArgs<Params>['args'],
    output: { log: (msg: string) => void },
    tasks: CommandArgs<Params>['tasks'],
  ): Promise<CommandResult<Result>> {
    const { account, label, when } = args

    let unsaved: InboxThread[]
    try {
      output.log(`\n  Fetching "${label}" for ${client.email}...`)
      const { threads } = await getInboxThreads(client, label)
      unsaved = threads.filter((t) => !t.saved)
    } catch (err) {
      return CommandResult.error(err as Error, 'Gmail fetch failed')
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
    const fetchResult = await tasks.run('google:email:inbox:fetch', {
      account,
      label,
      when,
      threadId: selectedThread.threadId,
    })

    if (!fetchResult.ok || !fetchResult.data || fetchResult.data.fetched === 0) {
      return CommandResult.fail('google:email:inbox:fetch failed')
    }

    const result = await this.createFollows(client, fetchResult.data.threads, label, output)

    // Archive from inbox; the Sky/Follow label stays
    await this.archiveThreads(client, [selectedThread.threadId], output)

    return result
  }

  /** Remove the INBOX label from each thread (decimal ids); label removal is close's job, not follow's. */
  private async archiveThreads(
    client: GoogleClient,
    threadIds: string[],
    output: { log: (msg: string) => void },
  ): Promise<void> {
    let archived = 0
    for (const threadId of threadIds) {
      try {
        await modifyThread(client, threadIdFromDecimal(threadId), { removeLabelIds: ['INBOX'] })
        archived++
      } catch (err) {
        output.log(`  Warning: archive failed: ${(err as Error).message}`)
      }
    }
    if (archived > 0) {
      output.log(`  Archived ${archived} thread(s) from inbox.`)
    }
  }

  private async createFollows(
    client: GoogleClient,
    threads: { threadId: string; from: string; subject: string; messages: { date: string; path: string }[] }[],
    label: string,
    output: { log: (msg: string) => void },
  ): Promise<CommandResult<Result>> {
    const now = fetchNowSync()
    const created: string[] = []

    for (const thread of threads) {
      if (thread.messages.length === 0) continue

      let follow = Follow.create({
        source: 'Email',
        ref: { account: client.email, threadId: thread.threadId, label },
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
