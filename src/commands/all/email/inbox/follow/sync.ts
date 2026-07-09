import * as path from 'node:path'
import type { ImapFlow } from 'imapflow'
import { DIR_BASE, DIR_STATE_FOLLOW_EMAIL_ACTIVE } from '#config'
import { outputFile, writeTextFile } from '#shared/fs/mod.ts'
import { fetchNowSync } from '#shared/nbfs/mod.ts'
import slugify from '#lib/string/slugify.ts'
import Follow from '#shared/models/Follow/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import EmailFollowRegistry from '#shared/models/Follow/EmailFollowRegistry.ts'
import openEditor from '#lib/shell/openEditor.ts'
import * as p from '@clack/prompts'
import { createImapClient } from '../../lib/imap-client.ts'
import { getInboxThreads } from '../../lib/getInboxThreads.ts'
import type { InboxThread, InboxThreadsResult } from '../../lib/getInboxThreads.ts'
import { fetchUnsavedThreads } from '../../lib/fetchUnsavedThreads.ts'
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

const NOTHING_SYNCED: SyncResult = { newFollows: 0, updatedFollows: 0, fetchedMessages: 0 }

export default class EmailInboxFollowSyncTask extends Command {
  static override description: CommandDescription = {
    name: 'email:inbox:follow:sync',
    description: 'Sync all email threads: create follows for new, fetch new messages for existing.',
    descriptionLong: [
      'Runs the email:inbox:fetch core to download unsaved messages, then:',
      '  - First-time threads: captures the whole thread as ONE entry dated today, creates follow file',
      '  - Already-followed threads: appends each new message on its own date, updates follow file',
      '  - Archives processed threads from inbox',
      'One IMAP connection is shared across picking, fetching, and archiving.',
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

    // One IMAP connection serves the whole run: pick, fetch, and archive.
    output.log(`\n  Connecting to Gmail IMAP as ${entry.user}...`)
    const creds = { user: entry.user, pass: entry.pass }
    let client = createImapClient(creds)
    client.on('error', () => {})

    try {
      await client.connect()

      // ── Optional: interactive single-thread pick (testing/triage) ─────────
      let pickedThreadId: string | undefined
      let inbox: InboxThreadsResult | undefined
      if (pick) {
        try {
          inbox = await getInboxThreads(client, label, { limit })
        } catch (err) {
          output.log(`  Warning: could not list threads: ${(err as Error).message}`)
          return CommandResult.success(NOTHING_SYNCED)
        }
        pickedThreadId = await this.promptForThread(inbox.threads, output)
        if (!pickedThreadId) {
          return CommandResult.success(NOTHING_SYNCED)
        }
      }

      // ── Phase 2: Fetch unsaved messages (email:inbox:fetch core) ──────────
      // The pick's thread listing is passed through so the label+INBOX scan isn't redone.
      // collapseNewThreads: a first-time follow captures the whole backlog as one entry dated
      // today; once followed, later replies stream onto their own dates.
      const fetchResult = await fetchUnsavedThreads(
        client,
        {
          label,
          limit,
          collapseNewThreads: true,
          ...(pickedThreadId ? { threadId: pickedThreadId } : {}),
          ...(inbox ? { inbox } : {}),
        },
        { tasks, output },
      )

      if (fetchResult.fetched === 0) {
        output.log('  All threads synced. Nothing to do.\n')
        return CommandResult.success(NOTHING_SYNCED)
      }

      // ── Phase 3: Create/update follow files ──────────────────────────────
      const now = fetchNowSync()
      let newFollows = 0
      let updatedFollows = 0

      for (const thread of fetchResult.threads) {
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
      // The per-message AI conversion in fetch can outlive the socket timeout;
      // reconnect if the shared connection died in the meantime.
      const threadIds = fetchResult.threads.map((t) => t.threadId)
      if (threadIds.length > 0 && !client.usable) {
        output.log('  Connection expired — reconnecting for archive...')
        client = createImapClient(creds)
        client.on('error', () => {})
        await client.connect()
      }
      await this.archiveFromInbox(threadIds, client, output)

      // --pick is interactive triage: open the picked thread's most recent entry
      if (pickedThreadId) {
        const picked = fetchResult.threads.find((t) => t.threadId === pickedThreadId)
        const latest = picked?.messages.at(-1)
        if (latest) {
          output.log(`  Opening ${latest.path}`)
          await openEditor([{ file: path.join(DIR_BASE, latest.path) }])
        }
      }

      const fetched = fetchResult.fetched
      output.log(`\n  Sync complete: ${newFollows} new, ${updatedFollows} updated, ${fetched} message(s).\n`)
      return CommandResult.success({ newFollows, updatedFollows, fetchedMessages: fetched })
    } catch (err) {
      return CommandResult.error(err as Error, 'email:inbox:follow:sync failed')
    } finally {
      await client.logout().catch(() => {})
    }
  }

  /** Let the user pick one unsaved tagged thread. Returns its threadId, or undefined. */
  private async promptForThread(
    threads: InboxThread[],
    output: { log: (msg: string) => void },
  ): Promise<string | undefined> {
    const unsaved = threads
      .filter((t) => !t.saved)
      .map((t) => {
        const first = t.messages[0]
        // Messages are sorted oldest-first, so the last one is the most recent
        const latest = t.messages.at(-1)
        return {
          threadId: t.threadId,
          from: first?.from?.name || first?.from?.address || '(unknown)',
          subject: first?.subject || '(no subject)',
          date: latest?.date ? PlainDate.from(latest.date).toString() : undefined,
          count: t.messages.length,
          followed: t.savedMessages.length > 0,
        }
      })

    if (unsaved.length === 0) {
      output.log('  No unsaved tagged threads to sync.\n')
      return undefined
    }

    const selected = await p.select({
      message: 'Which thread to sync?',
      options: unsaved.map((t) => ({
        value: t.threadId,
        label: t.date ? `[${t.date}] ${t.subject}` : t.subject,
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
    client: ImapFlow,
    output: { log: (msg: string) => void },
  ): Promise<void> {
    if (threadIds.length === 0) return

    const threadIdSet = new Set(threadIds)
    try {
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
    }
  }
}
