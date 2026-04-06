import * as path from 'node:path'
import { DIR_HEARTBEAT_FOLLOW } from '#config'
import { exists, outputFile, writeTextFile } from '#shared/fs/mod.ts'
import { fetchNowSync } from '#shared/nbfs/mod.ts'
import slugify from '#lib/string/slugify.ts'
import Follow from '#shared/models/Follow/mod.ts'
import FollowRegistry from '#shared/models/Follow/FollowRegistry.ts'
import { createImapClient } from '../../lib/imap-client.ts'
import type { FetchedThread } from '../fetch.ts'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'

const params = {
  account: Flag.string('Account name from secrets (e.g. user@example.com)'),
  label: Flag.string('Gmail label to sync', { default: () => 'Sky/Follow' }),
  limit: Flag.number('Max messages to fetch', { default: () => 50 }),
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
      '  - Threads without follows: creates follow files',
      '  - Threads with follows but new messages: updates follow files',
      '  - Archives processed threads from inbox',
      'Designed to run on the heartbeat. Idempotent and non-interactive.',
    ],
    usage: ['sky email:inbox:follow:sync --account user@example.com'],
    params,
  }

  async run({ args, context, tasks }: CommandArgs<Params>): Promise<CommandResult<SyncResult>> {
    const { output, secrets } = context
    const { account, label, limit } = args

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
    const registry = (await exists(DIR_HEARTBEAT_FOLLOW)) ? await FollowRegistry.build(DIR_HEARTBEAT_FOLLOW) : null

    // ── Phase 2: Fetch unsaved messages (delegates to email:inbox:fetch) ──
    // fetch derives per-thread `previous` from follow savedMessages via getInboxThreads
    const fetchResult = await tasks.run('email:inbox:fetch', { account, label, limit })

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

      const existingFollow = registry
        ? registry.getAll().find((e) => e.follow.source === 'Email' && e.follow.ref.threadId === thread.threadId)
        : undefined

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
        const filePath = path.join(DIR_HEARTBEAT_FOLLOW, `${fileName}.yaml`)

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
