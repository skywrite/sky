import * as path from 'node:path'
import * as p from '@clack/prompts'
import { Command, CommandPlatform, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { DIR_BASE } from '#config'
import { AccountResolutionError, modifyThread, threadIdFromDecimal } from '#lib/google/mod.ts'
import type { GoogleClient } from '#lib/google/mod.ts'
import openEditor from '#lib/shell/openEditor.ts'
import { writeTextFile } from '#shared/fs/mod.ts'
import EmailFollowRegistry from '#shared/models/Follow/EmailFollowRegistry.ts'
import Follow from '#shared/models/Follow/mod.ts'
import { fetchNowSync, toTimeRef } from '#shared/nbfs/mod.ts'
import { PlainDate, PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import { fetchUnsavedThreads } from '../../lib/fetchUnsavedThreads.ts'
import type { FetchedThread } from '../../lib/fetchUnsavedThreads.ts'
import { expireQuietFollows, persistNewFollow, planThreadFollow } from '../../lib/followLifecycle.ts'
import { getInboxThreads, LISTING_DEPTH } from '../../lib/getInboxThreads.ts'
import type { InboxThread, InboxThreadsResult } from '../../lib/getInboxThreads.ts'
import { resolveGmailClient } from '../../lib/resolveGmailClient.ts'
import { formatSyncReport } from '../../lib/syncReport.ts'
import type { ClosedThread, SyncedThread } from '../../lib/syncReport.ts'

const params = {
  account: Flag.string('Google account (email or unique part of it)', { short: 'a' }),
  label: Flag.string('Gmail label to sync', { default: () => 'Sky/Follow' }),
  limit: Flag.number('Max unsaved threads to capture per run', { default: () => 250 }),
  pick: Flag.bool('Interactively pick a single tagged thread to sync (for testing/triage)', {
    default: false,
  }),
  noAutoTag: Flag.bool('Skip automatic tagging from the archived-email tag corpus', { default: false }),
  noAutoRel: Flag.bool('Skip automatic rel suggestion from the entity graph', { default: false }),
  noEditor: Flag.bool('Skip opening captured entries in the editor', { default: false }),
}

type Params = InferParams<typeof params>
type SyncResult = {
  newFollows: number
  updatedFollows: number
  bornExpired: number
  expired: string[]
  fetchedMessages: number
}

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'google:email:inbox:follow:sync': { params: Params; result: SyncResult }
  }
}

const NOTHING_SYNCED: SyncResult = { newFollows: 0, updatedFollows: 0, bornExpired: 0, expired: [], fetchedMessages: 0 }

/** Most entries a console run opens for review — past this, the closing report is the review surface. */
const MAX_EDITOR_OPENS = 10

export default class GoogleEmailInboxFollowSyncTask extends Command {
  static override description: CommandDescription = {
    name: 'google:email:inbox:follow:sync',
    description: 'Sync all email threads: create follows for new, fetch new messages for existing.',
    descriptionLong: [
      'Gmail-API twin of email:inbox:follow:sync, using the OAuth grant from',
      'google:auth (requires the Gmail scope).',
      'Runs the google:email:inbox:fetch core to download unsaved messages, then:',
      '  - First-time threads: each message lands on its own date, creates follow file;',
      '    threads already quiet past the expiry window are captured and closed instead',
      '  - Already-followed threads: appends each new message on its own date, updates follow file',
      '  - Archives processed threads from inbox',
      `  - Closes follows quiet past ${Follow.DEFAULT_MAX_INACTIVE}: Gmail label removed, follow YAML archived`,
      'Designed to run on the heartbeat. Idempotent and non-interactive.',
    ],
    usage: ['sky google:email:inbox:follow:sync', 'sky google:email:inbox:follow:sync --pick   # choose one thread'],
    params,
  }

  async run({ args, context, tasks }: CommandArgs<Params>): Promise<CommandResult<SyncResult>> {
    const { output, secrets } = context
    const { account, label, limit, pick, noAutoTag, noAutoRel, noEditor } = args

    // ── Phase 1: Load follow registry ────────────────────────────────────
    const registry = await EmailFollowRegistry.build()

    let client: GoogleClient
    try {
      client = await resolveGmailClient({ secrets, requested: account, interactive: pick })
    } catch (err) {
      if (err instanceof AccountResolutionError) return CommandResult.fail(err.message)
      throw err
    }

    try {
      // ── Optional: interactive single-thread pick (testing/triage) ─────────
      let pickedThreadId: string | undefined
      let inbox: InboxThreadsResult | undefined
      if (pick) {
        try {
          // Deep listing: the picker must offer every unsaved thread, not the
          // N newest bucket entries (which go stale-saved over time).
          inbox = await getInboxThreads(client, label, { limit: LISTING_DEPTH })
        } catch (err) {
          output.log(`  Warning: could not list threads: ${(err as Error).message}`)
          return CommandResult.success(NOTHING_SYNCED)
        }
        pickedThreadId = await this.promptForThread(inbox.threads, output)
        if (!pickedThreadId) {
          return CommandResult.success(NOTHING_SYNCED)
        }
      }

      // ── Phase 2: Fetch unsaved messages (google:email:inbox:fetch core) ───
      // The pick's thread listing is passed through so the label scan isn't redone.
      const fetchResult = await fetchUnsavedThreads(
        client,
        {
          label,
          limit,
          follow: true,
          noAutoTag,
          noAutoRel,
          ...(pickedThreadId ? { threadId: pickedThreadId } : {}),
          ...(inbox ? { inbox } : {}),
        },
        { tasks, output },
      )

      const now = fetchNowSync()
      let newFollows = 0
      let updatedFollows = 0
      let bornExpired = 0
      const synced: SyncedThread[] = []
      const closed: ClosedThread[] = []
      // Threads whose follow was created this run — the captures a person
      // wants in front of them to check the fresh tagging.
      const firstCaptures = new Set<string>()

      if (fetchResult.fetched === 0) {
        output.log('  All threads synced.')
      } else {
        // ── Phase 3: Create/update follow files ────────────────────────────
        for (const thread of fetchResult.threads) {
          if (thread.messages.length === 0) continue

          const lastMessageAt = thread.lastMessageAt ? PlainDateTime.fromString(thread.lastMessageAt) : undefined
          const existingFollow = registry.findByThreadId(thread.threadId)

          if (existingFollow) {
            let follow = existingFollow.follow
            // New entries are stored as time refs; old follows may hold paths
            // in any layout (or damaged ones). Dedupe on the canonical form,
            // falling back to the raw string where canonicalizing fails —
            // a duplicate follow entry is cheaper than a lost sync.
            const canon = (p: string): string => {
              try {
                return toTimeRef(p)
              } catch {
                return p
              }
            }
            const existingPaths = new Set(follow.messages.map((m) => canon(m.path)))
            for (const msg of thread.messages) {
              if (existingPaths.has(canon(msg.path))) continue
              follow = follow.addMessage(msg.date, toTimeRef(msg.path))
            }
            // lastActivity is the newest message's real time, not the sync time —
            // a reply discovered late must not look like fresh activity
            if (lastMessageAt) follow = follow.updateLastActivity(lastMessageAt)
            follow = follow.updateLastChecked(now.plainDateTime)

            await writeTextFile(existingFollow.path, follow.toYaml())
            output.log(`  Updated follow: ${path.basename(existingFollow.path, '.yaml')}`)
            updatedFollows++
            // A continuation is not summarized again, so the follow's own label
            // is what names it — the same one its earlier captures carry.
            synced.push({
              from: thread.from,
              label: follow.summary || thread.subject,
              messages: thread.captured,
              state: 'updated',
            })
          } else {
            const planned = planThreadFollow({
              accountEmail: client.email,
              label,
              thread,
              now: now.plainDateTime,
            })
            const persisted = await persistNewFollow({ client, labelId: fetchResult.labelId, planned, output })
            firstCaptures.add(thread.threadId)
            const topic = thread.summary || thread.subject
            synced.push({
              from: thread.from,
              label: topic,
              messages: thread.captured,
              state: 'new',
              ...(persisted.followed ? {} : { closed: true }),
            })
            if (persisted.followed) newFollows++
            else {
              bornExpired++
              // Captured and retired in one run: it belongs in both lists.
              closed.push({
                label: topic,
                reason: `already quiet past ${Follow.DEFAULT_MAX_INACTIVE} when first seen`,
                captured: thread.captured,
              })
            }
          }
        }

        // ── Phase 4: Archive processed threads from inbox ──────────────────
        // Failed threads stay in the inbox so the next sync retries them.
        await this.archiveFromInbox(client, fetchResult.threads, output)

        // A console run is a person catching up: open everything captured.
        // On the heartbeat (Server platform) open only FIRST captures — a new
        // follow means fresh AI tagging worth a human glance, while
        // continuations inherit already-reviewed fields. Capped — a backlog
        // drain creates dozens of files, and a wall of tabs reviews worse
        // than the report below.
        const created = fetchResult.threads.flatMap((t) => t.messages)
        const reviewable =
          context.platform === CommandPlatform.Console
            ? created
            : context.platform === CommandPlatform.Server
              ? fetchResult.threads.filter((t) => firstCaptures.has(t.threadId)).flatMap((t) => t.messages)
              : []
        if (!noEditor && reviewable.length > 0) {
          const toOpen = reviewable.slice(0, MAX_EDITOR_OPENS)
          const rest = reviewable.length - toOpen.length
          output.log(
            `  Opening ${toOpen.length} captured entr${toOpen.length === 1 ? 'y' : 'ies'}${rest > 0 ? ` (${rest} more listed in the report below)` : ''}`,
          )
          try {
            await openEditor(toOpen.map((m) => ({ file: path.join(DIR_BASE, m.path) })))
          } catch (err) {
            // A heartbeat must never fail over an editor that couldn't spawn.
            output.log(`  Warning: could not open editor (${(err as Error).message})`)
          }
        }
      }

      // ── Phase 5: Expire quiet follows (parity with slack:follow:check) ───
      // After capture, so a thread's final unsaved messages land before its
      // follow closes. Rebuilt registry: phase 3 wrote follows the boot-time
      // one doesn't know. --pick skips it — triage must not close follows.
      let expired: string[] = []
      if (!pick) {
        const sweepRegistry = await EmailFollowRegistry.build()
        const sweep = await expireQuietFollows({
          client,
          entries: sweepRegistry.getActive(),
          fallbackLabel: label,
          now: now.plainDateTime,
          output,
        })
        expired = sweep.expired.map((e) => e.fileName)
        // Follows the sweep retired carry no capture this run — their threads
        // went quiet, which is why they closed.
        for (const e of sweep.expired) closed.push({ label: e.summary, reason: e.reason })
      }

      const fetched = fetchResult.fetched
      const closedNote = bornExpired > 0 ? `, ${bornExpired} captured and closed` : ''
      const expiredNote = expired.length > 0 ? `, ${expired.length} expired` : ''
      for (const line of formatSyncReport(synced, closed)) output.log(line)
      output.log(
        `\n  Sync complete: ${newFollows} new, ${updatedFollows} updated${closedNote}${expiredNote}, ${fetched} message(s).\n`,
      )
      return CommandResult.success({ newFollows, updatedFollows, bornExpired, expired, fetchedMessages: fetched })
    } catch (err) {
      return CommandResult.error(err as Error, 'google:email:inbox:follow:sync failed')
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

  /** Remove processed threads from inbox (the Sky/Follow label stays so inbox:view shows them as saved). */
  private async archiveFromInbox(
    client: GoogleClient,
    threads: FetchedThread[],
    output: { log: (msg: string) => void },
  ): Promise<void> {
    const toArchive = threads.filter((t) => !t.failed)
    if (toArchive.length === 0) return

    let archived = 0
    for (const thread of toArchive) {
      try {
        await modifyThread(client, threadIdFromDecimal(thread.threadId), { removeLabelIds: ['INBOX'] })
        archived++
      } catch (err) {
        output.log(`  Warning: archive failed: ${(err as Error).message}`)
      }
    }
    if (archived > 0) {
      output.log(`  Archived ${archived} thread(s) from inbox.`)
    }
  }
}
