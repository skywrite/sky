import * as path from 'node:path'
import * as p from '@clack/prompts'
import { Command, CommandPlatform, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { DIR_BASE } from '#config'
import { AccountResolutionError, modifyThread, resolveLabel, threadIdFromDecimal } from '#lib/google/mod.ts'
import type { GoogleClient } from '#lib/google/mod.ts'
import openEditor from '#lib/shell/openEditor.ts'
import { writeTextFile } from '#shared/fs/mod.ts'
import EmailFollowRegistry from '#shared/models/Follow/EmailFollowRegistry.ts'
import Follow from '#shared/models/Follow/mod.ts'
import { fetchNow, toTimeRef } from '#shared/nbfs/mod.ts'
import { PlainDate, PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import { fetchUnsavedThreads } from '../../lib/fetchUnsavedThreads.ts'
import type { FetchedThread, FetchUnsavedResult } from '../../lib/fetchUnsavedThreads.ts'
import {
  applyNowLabelSwaps,
  expireQuietFollows,
  persistNewFollow,
  planThreadFollow,
  selectNowLabelSwaps,
  threadsToArchive,
} from '../../lib/followLifecycle.ts'
import { getInboxThreads, LISTING_DEPTH } from '../../lib/getInboxThreads.ts'
import type { InboxThread, InboxThreadsResult } from '../../lib/getInboxThreads.ts'
import { resolveGmailClient } from '../../lib/resolveGmailClient.ts'
import { formatSyncReport } from '../../lib/syncReport.ts'
import type { ClosedThread, SyncedThread } from '../../lib/syncReport.ts'

/**
 * Sub-label of the bucket that files a thread on the day it is picked up, not
 * the days its mail carries. Optional: an account without the label in Gmail
 * simply has no Now door.
 */
const NOW_SUBLABEL = 'Now'

const params = {
  account: Flag.string('Google account (email or unique part of it)', { short: 'a' }),
  label: Flag.string('Gmail label to sync (its /Now sub-label is scanned too)', { default: () => 'Sky/Follow' }),
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

type PickedThread = { threadId: string; door: 'now' | 'bucket' }

/** One entry door's phase-3 outcome, merged with the other door's for the run report. */
type DoorOutcome = {
  newFollows: number
  updatedFollows: number
  bornExpired: number
  synced: SyncedThread[]
  closed: ClosedThread[]
  /** Threads whose follow was created this run — what gets archived/swapped, and opened for tag review. */
  firstCaptures: Set<string>
}

export default class GoogleEmailInboxFollowSyncTask extends Command {
  static override description: CommandDescription = {
    name: 'google:email:inbox:follow:sync',
    description: 'Sync all email threads: create follows for new, fetch new messages for existing.',
    descriptionLong: [
      'Gmail-API twin of email:inbox:follow:sync, using the OAuth grant from',
      'google:auth (requires the Gmail scope).',
      'Two entry labels feed one bucket (default Sky/Follow):',
      '  - The bucket label itself: each message lands on its own date; a thread',
      '    already quiet past the expiry window is captured and closed on the spot',
      '  - Its /Now sub-label: the whole thread lands as one entry on the day it is',
      '    picked up and the watch starts there, however old the mail. After first',
      '    capture the sub-label is swapped for the bucket label, so the bare label',
      '    always reads "being tracked".',
      'Either way:',
      '  - Already-followed threads: appends each new message on its own date, updates follow file',
      '  - Archives first captures from inbox; replies to followed threads stay in the inbox',
      `  - Closes follows quiet past ${Follow.DEFAULT_MAX_INACTIVE}: Gmail label removed, follow YAML archived`,
      'Designed to run on the heartbeat. Idempotent and non-interactive.',
    ],
    usage: ['sky google:email:inbox:follow:sync', 'sky google:email:inbox:follow:sync --pick   # choose one thread'],
    params,
  }

  async run({ args, context, tasks }: CommandArgs<Params>): Promise<CommandResult<SyncResult>> {
    const { output, secrets } = context
    const { account, label, limit, pick, noAutoTag, noAutoRel, noEditor } = args
    const nowLabel = `${label}/${NOW_SUBLABEL}`

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
      const now = await fetchNow()

      // ── Phase 2a: List both entry labels ─────────────────────────────────
      // Deep listings: captured threads keep the bucket label, so the
      // newest-first listing tops out with saved threads over time and a bound
      // applied here would starve unsaved ones (see LISTING_DEPTH).
      let nowInbox: InboxThreadsResult | undefined
      if (await resolveLabel(client, nowLabel)) {
        try {
          nowInbox = await getInboxThreads(client, nowLabel, { limit: LISTING_DEPTH })
        } catch (err) {
          output.log(`  Warning: could not list ${nowLabel} (${(err as Error).message}) — skipping the Now door`)
        }
      }
      const bucketListing = await getInboxThreads(client, label, { limit: LISTING_DEPTH })
      // A thread wearing both labels is the Now door's: the sub-label is the
      // explicit act, and two doors capturing one thread would double it.
      const nowThreadIds = new Set((nowInbox?.threads ?? []).map((t) => t.threadId))
      const bucketInbox = {
        ...bucketListing,
        threads: bucketListing.threads.filter((t) => !nowThreadIds.has(t.threadId)),
      }

      // ── Optional: interactive single-thread pick (testing/triage) ─────────
      let picked: PickedThread | undefined
      if (pick) {
        picked = await this.promptForThread(nowInbox?.threads ?? [], bucketInbox.threads, output)
        if (!picked) {
          return CommandResult.success(NOTHING_SYNCED)
        }
      }

      // ── Phase 2b: Fetch unsaved messages (google:email:inbox:fetch core) ──
      // The listings above are passed through so the label scans aren't redone.
      const nothing: FetchUnsavedResult = { fetched: 0, threads: [], labelId: '' }
      const runNowDoor = !!nowInbox && nowInbox.threads.some((t) => !t.saved) && (!picked || picked.door === 'now')
      const nowFetch =
        runNowDoor && nowInbox
          ? await fetchUnsavedThreads(
              client,
              {
                label: nowLabel,
                limit,
                // The Now door's point: the capture lands on the pickup day,
                // not the days the mail carries.
                when: now.plainDateTime,
                follow: true,
                inbox: nowInbox,
                noAutoTag,
                noAutoRel,
                ...(picked ? { threadId: picked.threadId } : {}),
              },
              { tasks, output },
            )
          : nothing
      const bucketFetch =
        !picked || picked.door === 'bucket'
          ? await fetchUnsavedThreads(
              client,
              {
                label,
                limit,
                follow: true,
                inbox: bucketInbox,
                noAutoTag,
                noAutoRel,
                ...(picked ? { threadId: picked.threadId } : {}),
              },
              { tasks, output },
            )
          : nothing

      // ── Phase 3: Create/update follow files ────────────────────────────
      // Both doors write the bucket label into ref: — a Now thread wears it
      // after the swap below, and expiry must remove what is worn.
      const nowDoor = await this.trackFetchedThreads({
        registry,
        client,
        fetchResult: nowFetch,
        label,
        now: now.plainDateTime,
        force: true,
        output,
      })
      const bucketDoor = await this.trackFetchedThreads({
        registry,
        client,
        fetchResult: bucketFetch,
        label,
        now: now.plainDateTime,
        force: false,
        output,
      })

      if (nowFetch.fetched + bucketFetch.fetched === 0) {
        output.log('  All threads synced.')
      }

      const synced = [...nowDoor.synced, ...bucketDoor.synced]
      const closed = [...nowDoor.closed, ...bucketDoor.closed]

      // ── Phase 4: Retire entry labels ───────────────────────────────────
      // Bucket door: only threads followed for the first time this run leave
      // the inbox. A reply to a thread already followed is mail the owner has
      // not read yet — on the heartbeat this ran within minutes of arrival
      // and pulled the reply out of the inbox before anyone saw it. It stays
      // until they archive it; failed threads stay so the next sync retries.
      await this.archiveFromInbox(client, threadsToArchive(bucketFetch.threads, bucketDoor.firstCaptures), output)

      // Now door: captured threads trade the sub-label for the bucket label
      // (first captures leave the inbox in the same call). A --pick run swaps
      // only what it captured — triage must not sweep lingering labels.
      if (nowInbox) {
        const swaps = selectNowLabelSwaps(pick ? [] : nowInbox.threads, nowFetch.threads, nowDoor.firstCaptures)
        if (swaps.length > 0) {
          const swapped = await applyNowLabelSwaps({
            client,
            swaps,
            addLabelId: bucketListing.labelId,
            removeLabelId: nowInbox.labelId,
            output,
          })
          if (swapped > 0) output.log(`  Swapped ${swapped} thread(s) ${nowLabel} → ${label}.`)
        }
      }

      // A console run is a person catching up: open everything captured.
      // On the heartbeat (Server platform) open only FIRST captures — a new
      // follow means fresh AI tagging worth a human glance, while
      // continuations inherit already-reviewed fields. Capped — a backlog
      // drain creates dozens of files, and a wall of tabs reviews worse
      // than the report below.
      const allThreads = [...nowFetch.threads, ...bucketFetch.threads]
      const allFirstCaptures = new Set([...nowDoor.firstCaptures, ...bucketDoor.firstCaptures])
      const created = allThreads.flatMap((t) => t.messages)
      const reviewable =
        context.platform === CommandPlatform.Console
          ? created
          : context.platform === CommandPlatform.Server
            ? allThreads.filter((t) => allFirstCaptures.has(t.threadId)).flatMap((t) => t.messages)
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

      const newFollows = nowDoor.newFollows + bucketDoor.newFollows
      const updatedFollows = nowDoor.updatedFollows + bucketDoor.updatedFollows
      const bornExpired = nowDoor.bornExpired + bucketDoor.bornExpired
      const fetched = nowFetch.fetched + bucketFetch.fetched
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

  /**
   * Phase 3 for one entry door: create a follow per first-time thread, append
   * to the follow of each already-tracked one. `force` marks the Now door —
   * follow however quiet the thread is, because the follow-up starts at
   * pickup and its capture (collapsed to the pickup day) anchors the
   * inactivity clock there.
   */
  private async trackFetchedThreads(opts: {
    registry: EmailFollowRegistry
    client: GoogleClient
    fetchResult: FetchUnsavedResult
    label: string
    now: PlainDateTime
    force: boolean
    output: { log: (msg: string) => void }
  }): Promise<DoorOutcome> {
    const { registry, client, fetchResult, label, now, force, output } = opts
    const outcome: DoorOutcome = {
      newFollows: 0,
      updatedFollows: 0,
      bornExpired: 0,
      synced: [],
      closed: [],
      firstCaptures: new Set(),
    }

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
        follow = follow.updateLastChecked(now)

        await writeTextFile(existingFollow.path, follow.toYaml())
        output.log(`  Updated follow: ${path.basename(existingFollow.path, '.yaml')}`)
        outcome.updatedFollows++
        // A continuation is not summarized again, so the follow's own label
        // is what names it — the same one its earlier captures carry.
        outcome.synced.push({
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
          now,
          force,
        })
        const persisted = await persistNewFollow({ client, labelId: fetchResult.labelId, planned, output })
        outcome.firstCaptures.add(thread.threadId)
        const topic = thread.summary || thread.subject
        outcome.synced.push({
          from: thread.from,
          label: topic,
          messages: thread.captured,
          state: 'new',
          ...(persisted.followed ? {} : { closed: true }),
        })
        if (persisted.followed) outcome.newFollows++
        else {
          outcome.bornExpired++
          // Captured and retired in one run: it belongs in both lists.
          outcome.closed.push({
            label: topic,
            reason: `already quiet past ${Follow.DEFAULT_MAX_INACTIVE} when first seen`,
            captured: thread.captured,
          })
        }
      }
    }

    return outcome
  }

  /** Let the user pick one unsaved tagged thread from either door. Returns its threadId + door, or undefined. */
  private async promptForThread(
    nowThreads: InboxThread[],
    bucketThreads: InboxThread[],
    output: { log: (msg: string) => void },
  ): Promise<PickedThread | undefined> {
    const rows = [
      ...nowThreads.map((t) => ({ t, door: 'now' as const })),
      ...bucketThreads.map((t) => ({ t, door: 'bucket' as const })),
    ]
    const doorByThread = new Map<string, 'now' | 'bucket'>()
    const unsaved = rows
      .filter(({ t }) => !t.saved)
      .map(({ t, door }) => {
        doorByThread.set(t.threadId, door)
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
          door,
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
        hint: `${t.from} · ${t.count} msg${t.count === 1 ? '' : 's'} · ${t.followed ? 'new replies' : 'new'}${t.door === 'now' ? ' · Now' : ''}`,
      })),
    })

    if (p.isCancel(selected)) {
      p.cancel('Cancelled')
      return undefined
    }

    const threadId = selected as string
    return { threadId, door: doorByThread.get(threadId) ?? 'bucket' }
  }

  /** Remove the given threads from the inbox (the Sky/Follow label stays so inbox:view shows them as saved). */
  private async archiveFromInbox(
    client: GoogleClient,
    threads: FetchedThread[],
    output: { log: (msg: string) => void },
  ): Promise<void> {
    if (threads.length === 0) return

    let archived = 0
    for (const thread of threads) {
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
