import * as path from 'node:path'
import { DIR_STATE_FOLLOW_EMAIL_ACTIVE } from '#config'
import { outputFile, writeTextFile } from '#shared/fs/mod.ts'
import { fetchNowSync } from '#shared/nbfs/mod.ts'
import slugify from '#lib/string/slugify.ts'
import Follow from '#shared/models/Follow/mod.ts'
import EmailFollowRegistry from '#shared/models/Follow/EmailFollowRegistry.ts'
import * as p from '@clack/prompts'
import { createImapClient } from '../../lib/imap-client.ts'
import { getInboxThreads } from '../../lib/getInboxThreads.ts'
import type { FetchedThread } from '../fetch.ts'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'

const params = {
  account: Flag.string('Account name from secrets (e.g. user@example.com)'),
  label: Flag.string('Gmail label to sync', { default: () => 'Sky/Follow' }),
  limit: Flag.number('Max messages to fetch', { default: () => 250 }),
  pick: Flag.boolean('Interactively pick a single tagged thread to sync (for testing/triage)', {
    default: false,
  }),
}

type Params = InferParams<typeof params>
type SyncResult = { newFollows: number; updatedFollows: number; fetchedMessages: number }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'email:inbox:follow:sync': { params: Params; result: SyncResult }
  }
}

export default class EmailInboxFollowSyncTask extends Command {
  static override description: CommandDescription = {
    name: 'email:inbox:follow:sync',
    description: 'Sync all email threads: create follows for new, fetch new messages for existing.',
    descriptionLong: [
      'Composes email:inbox:fetch to download unsaved messages, then:',
      '  - First-time threads: captures the whole thread as ONE entry dated today, creates follow file',
      '  - Already-followed threads: appends each new message on its own date, updates follow file',
      '  - Archives processed threads from inbox',
      'Designed to run on the heartbeat. Idempotent and non-interactive.',
    ],
    usage: [
      'sky email:inbox:follow:sync --account user@example.com',
      'sky email:inbox:follow:sync --account user@example.com --pick   # choose one thread',
    ],
    params,
  }

  async run({ args, context, tasks }: CommandArgs<Params>): Promise<CommandResult<SyncResult>> {
    const { output, secrets } = context
    const { account, label, limit, pick } = args

    if (!account) {
      return CommandResult.fail('--account is required')
    }

    const entry = await secrets.get('email', account)
    if (!entry || entry.type !== 'login') {
      return CommandResult.fail(
        `Login credentials not found for email/${account}. Set them with:\n  sky secrets:set email ${account}`,
      )
    }

    // ── Phase 1: Load follow registry ────────────────────────────────────
    const registry = await EmailFollowRegistry.build()

    // ── Optional: interactive single-thread pick (testing/triage) ─────────
    let pickedThreadId: string | undefined
    if (pick) {
      pickedThreadId = await this.promptForThread({ user: entry.user, pass: entry.pass }, label, limit, output)
      if (!pickedThreadId) {
        return CommandResult.success({ newFollows: 0, updatedFollows: 0, fetchedMessages: 0 })
      }
    }

    // ── Phase 2: Fetch unsaved messages (delegates to email:inbox:fetch) ──
    // fetch derives per-thread `previous` from follow savedMessages via getInboxThreads.
    // collapseNewThreads: a first-time follow captures the whole backlog as one entry dated
    // today; once followed, later replies stream onto their own dates.
    const fetchResult = await tasks.run('email:inbox:fetch', {
      account,
      label,
      limit,
      collapseNewThreads: true,
      ...(pickedThreadId ? { threadId: pickedThreadId } : {}),
    })

    if (!fetchResult.ok || !fetchResult.data) {
      return CommandResult.fail('email:inbox:fetch failed')
    }

    if (fetchResult.data.fetched === 0) {
      output.log('  All threads synced. Nothing to do.\n')
      return CommandResult.success({ newFollows: 0, updatedFollows: 0, fetchedMessages: 0 })
    }

    // ── Phase 3: Create/update follow files ──────────────────────────────
    const now = fetchNowSync()
    let newFollows = 0
    let updatedFollows = 0

    for (const thread of fetchResult.data.threads) {
      if (thread.messages.length === 0) continue

      const existingFollow = registry.findByThreadId(thread.threadId)

      if (existingFollow) {
        let follow = existingFollow.follow
        const existingPaths = new Set(follow.messages.map((m) => m.path))
        for (const msg of thread.messages) {
          if (existingPaths.has(msg.path)) continue
          follow = follow.addMessage(msg.date, msg.path)
        }
        follow = follow.updateLastActivity(now.plainDateTime).updateLastChecked(now.plainDateTime)

        await writeTextFile(existingFollow.path, follow.toYaml())
        output.log(`  Updated follow: ${path.basename(existingFollow.path, '.yaml')}`)
        updatedFollows++
      } else {
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
          follow = follow.addMessage(msg.date, msg.path)
        }
        follow = follow.updateLastActivity(now.plainDateTime)

        const fromSlug = slugify(thread.from, { preserveCase: true, suggestedLength: 30 })
        const summarySlug = slugify(thread.subject, { preserveCase: true, suggestedLength: 40 })
        const datePrefix = now.plainDateTime.plainDate.toString()
        const fileName = `${datePrefix}_email_${fromSlug}_${summarySlug}`
        const filePath = path.join(DIR_STATE_FOLLOW_EMAIL_ACTIVE, `${fileName}.yaml`)

        await outputFile(filePath, follow.toYaml())
        output.log(`  Created follow: ${fileName}`)
        newFollows++
      }
    }

    // ── Phase 4: Archive processed threads from inbox ────────────────────
    const threadIds = fetchResult.data.threads.map((t) => t.threadId)
    await this.archiveFromInbox(threadIds, { user: entry.user, pass: entry.pass }, output)

    const fetched = fetchResult.data.fetched
    output.log(`\n  Sync complete: ${newFollows} new, ${updatedFollows} updated, ${fetched} message(s).\n`)
    return CommandResult.success({ newFollows, updatedFollows, fetchedMessages: fetched })
  }

  /** List unsaved tagged threads and let the user pick one. Returns its threadId, or undefined. */
  private async promptForThread(
    creds: { user: string; pass: string },
    label: string,
    limit: number,
    output: { log: (msg: string) => void },
  ): Promise<string | undefined> {
    const client = createImapClient(creds)
    client.on('error', () => {})

    let unsaved: { threadId: string; from: string; subject: string; count: number; followed: boolean }[] = []
    try {
      await client.connect()
      const { threads } = await getInboxThreads(client, label, { limit })
      unsaved = threads
        .filter((t) => !t.saved)
        .map((t) => {
          const first = t.messages[0]
          return {
            threadId: t.threadId,
            from: first?.from?.name || first?.from?.address || '(unknown)',
            subject: first?.subject || '(no subject)',
            count: t.messages.length,
            followed: t.savedMessages.length > 0,
          }
        })
    } catch (err) {
      output.log(`  Warning: could not list threads: ${(err as Error).message}`)
      return undefined
    } finally {
      await client.logout().catch(() => {})
    }

    if (unsaved.length === 0) {
      output.log('  No unsaved tagged threads to sync.\n')
      return undefined
    }

    const selected = await p.select({
      message: 'Which thread to sync?',
      options: unsaved.map((t) => ({
        value: t.threadId,
        label: t.subject,
        hint: `${t.from} · ${t.count} msg${t.count === 1 ? '' : 's'} · ${t.followed ? 'new replies' : 'new'}`,
      })),
    })

    if (p.isCancel(selected)) {
      p.cancel('Cancelled')
      return undefined
    }

    return selected as string
  }

  /** Remove processed threads from inbox (archive = remove \\Inbox label via messageDelete) */
  private async archiveFromInbox(
    threadIds: string[],
    creds: { user: string; pass: string },
    output: { log: (msg: string) => void },
  ): Promise<void> {
    if (threadIds.length === 0) return

    const threadIdSet = new Set(threadIds)
    const client = createImapClient(creds)
    client.on('error', () => {})

    try {
      await client.connect()
      const lock = await client.getMailboxLock('INBOX')
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
        lock.release()
      }
    } catch (err) {
      output.log(`  Warning: archive failed: ${(err as Error).message}`)
    } finally {
      await client.logout().catch(() => {})
    }
  }
}
