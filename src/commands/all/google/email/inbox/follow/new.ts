import * as p from '@clack/prompts'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { AccountResolutionError, modifyThread, threadIdFromDecimal } from '#lib/google/mod.ts'
import type { GoogleClient } from '#lib/google/mod.ts'
import { writeTextFile } from '#shared/fs/mod.ts'
import EmailFollowRegistry from '#shared/models/Follow/EmailFollowRegistry.ts'
import { fetchNowSync } from '#shared/nbfs/mod.ts'
import { PlainDate, PlainDateTime as PDT } from '#universal/dates/nbdt/mod.ts'
import type { FetchedThread } from '../../lib/fetchUnsavedThreads.ts'
import { fetchUnsavedThreads } from '../../lib/fetchUnsavedThreads.ts'
import { continueFollow, persistNewFollow, planThreadFollow, resumeLabeledFollows } from '../../lib/followLifecycle.ts'
import { getInboxThreads, LISTING_DEPTH } from '../../lib/getInboxThreads.ts'
import type { InboxThread } from '../../lib/getInboxThreads.ts'
import { resolveGmailClient } from '../../lib/resolveGmailClient.ts'

const params = {
  account: Flag.string('Google account (email or unique part of it)', { short: 'a' }),
  label: Flag.string('Gmail label', { default: () => 'Sky/Follow' }),
  limit: Flag.number('Max unsaved threads to capture per run', { default: () => 250 }),
  when: Flag.plainDateTime('Collapse all messages to this date', { parse: PDT.fromString }),
  force: Flag.bool('Follow even when the thread is already inactive past the expiry window', { default: false }),
  noAutoTag: Flag.bool('Skip automatic tagging from the archived-email tag corpus', { default: false }),
  noAutoRel: Flag.bool('Skip automatic rel suggestion from the entity graph', { default: false }),
}

type Params = InferParams<typeof params>
type Result = { created: number; bornExpired: number; follows: string[] }
type FollowDirs = { activeDir: string; archiveDir: string }

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
      'into one file at the specified date (like slack:follow:message).',
      'Threads already quiet past the expiry window are captured and closed',
      'instead of followed (--force to follow anyway).',
    ],
    usage: ['sky google:email:inbox:follow:new', 'sky google:email:inbox:follow:new --when 17:00'],
    params,
  }

  async run({ args, context, tasks }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output, secrets } = context
    const { account, label, limit, when } = args
    const dirs = {
      activeDir: context.config.DIR_STATE_FOLLOW_EMAIL_ACTIVE,
      archiveDir: context.config.DIR_STATE_FOLLOW_EMAIL_ARCHIVE,
    }

    let client: GoogleClient
    try {
      client = await resolveGmailClient({ secrets, requested: account, interactive: true })
    } catch (err) {
      if (err instanceof AccountResolutionError) return CommandResult.fail(err.message)
      throw err
    }

    if (when) {
      // ── Single-thread mode: chooser + collapse into one file ───────
      return this.runSingleThread(client, args, output, tasks, dirs)
    }

    // ── Batch mode: fetch + follow ALL unsaved threads ─────────────
    const inbox = await getInboxThreads(client, label, {
      limit: LISTING_DEPTH,
      followDir: dirs.activeDir,
      followArchiveDir: dirs.archiveDir,
    })
    await resumeLabeledFollows({
      client,
      threads: inbox.threads,
      label,
      labelId: inbox.labelId,
      now: fetchNowSync().plainDateTime,
      output,
      ...dirs,
    })
    const fetched = await fetchUnsavedThreads(
      client,
      {
        label,
        limit,
        follow: true,
        inbox,
        noAutoTag: args.noAutoTag,
        noAutoRel: args.noAutoRel,
      },
      { tasks, output },
    )
    const result = await this.createFollows(client, fetched, label, args.force, output, dirs)

    // Archive from inbox; the Sky/Follow label stays so inbox:view shows the
    // thread as saved.
    const threadIds = fetched.threads
      .filter((t) => !t.failed && !inbox.threads.find((listed) => listed.threadId === t.threadId)?.followFile)
      .map((t) => t.threadId)
    await this.archiveThreads(client, threadIds, output)

    return result
  }

  private async runSingleThread(
    client: GoogleClient,
    args: CommandArgs<Params>['args'],
    output: { log: (msg: string) => void },
    tasks: CommandArgs<Params>['tasks'],
    dirs: FollowDirs,
  ): Promise<CommandResult<Result>> {
    const { label, when } = args

    let unsaved: InboxThread[]
    try {
      output.log(`\n  Fetching "${label}" for ${client.email}...`)
      const { threads } = await getInboxThreads(client, label, {
        limit: LISTING_DEPTH,
        followDir: dirs.activeDir,
        followArchiveDir: dirs.archiveDir,
      })
      unsaved = threads.filter((t) => !t.saved || t.followStatus === 'closed')
    } catch (err) {
      return CommandResult.error(err as Error, 'Gmail fetch failed')
    }

    if (unsaved.length === 0) {
      output.log('  No unsaved threads to follow.\n')
      return CommandResult.success({ created: 0, bornExpired: 0, follows: [] })
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
        const date = first.date ? PlainDate.from(first.date).toString() : '(no date)'
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
    const inbox = await getInboxThreads(client, label, {
      limit: LISTING_DEPTH,
      followDir: dirs.activeDir,
      followArchiveDir: dirs.archiveDir,
    })
    await resumeLabeledFollows({
      client,
      threads: inbox.threads.filter((t) => t.threadId === selectedThread.threadId),
      label,
      labelId: inbox.labelId,
      now: fetchNowSync().plainDateTime,
      output,
      ...dirs,
    })
    const fetched = await fetchUnsavedThreads(
      client,
      {
        label,
        when,
        limit: 1,
        threadId: selectedThread.threadId,
        follow: true,
        inbox,
        noAutoTag: args.noAutoTag,
        noAutoRel: args.noAutoRel,
      },
      { tasks, output },
    )
    const result = await this.createFollows(client, fetched, label, args.force, output, dirs)

    // Archive from inbox; the Sky/Follow label stays
    if (!selectedThread.followFile && fetched.threads.some((t) => !t.failed && t.messages.length > 0)) {
      await this.archiveThreads(client, [selectedThread.threadId], output)
    }

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
    fetched: { threads: FetchedThread[]; labelId: string },
    label: string,
    force: boolean,
    output: { log: (msg: string) => void },
    dirs: FollowDirs,
  ): Promise<CommandResult<Result>> {
    const now = fetchNowSync()
    const created: string[] = []
    let bornExpired = 0
    const registry = await EmailFollowRegistry.build(dirs.activeDir)

    for (const thread of fetched.threads) {
      if (thread.messages.length === 0) continue

      const existing = registry.findByThreadId(thread.threadId, client.email)
      if (existing) {
        await writeTextFile(existing.path, continueFollow(existing.follow, thread, now.plainDateTime).toYaml())
        created.push(existing.fileName)
        continue
      }

      const planned = planThreadFollow({
        accountEmail: client.email,
        label,
        thread,
        now: now.plainDateTime,
        force,
      })
      const persisted = await persistNewFollow({ client, labelId: fetched.labelId, planned, output, ...dirs })
      if (persisted.followed) created.push(persisted.fileName)
      else bornExpired++
    }

    const closedNote = bornExpired > 0 ? `, ${bornExpired} captured and closed` : ''
    output.log(`\n  ${created.length} follow(s) created${closedNote}.\n`)
    return CommandResult.success({ created: created.length, bornExpired, follows: created })
  }
}
