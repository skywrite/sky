import { unlink } from 'node:fs/promises'
import * as path from 'node:path'
import { DIR_STATE_FOLLOW_EMAIL_ACTIVE, DIR_STATE_FOLLOW_EMAIL_ARCHIVE } from '#config'
import { modifyThread, resolveLabelId, threadIdFromDecimal } from '#lib/google/mod.ts'
import type { GoogleClient } from '#lib/google/mod.ts'
import slugify from '#lib/string/slugify.ts'
import { exists, outputFile } from '#shared/fs/mod.ts'
import Follow from '#shared/models/Follow/mod.ts'
import { toTimeRef } from '#shared/nbfs/mod.ts'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import type { FetchedThread } from './fetchUnsavedThreads.ts'

// First-time follow creation, shared by follow:new and follow:sync, and the
// Gmail label lifecycle around a follow (first-capture archiving, the Now
// door's entry-label swap, expiry). Mirrors slack:follow:message's decline
// rule: a thread already quiet past the expiry window is an archive, not
// something to watch — its content is captured, but the follow is born closed
// and the thread leaves the Sky/Follow bucket.

export type PlannedFollow = {
  follow: Follow
  threadId: string
  fileName: string
  /** Thread was already inactive past the expiry window at capture time. */
  bornExpired: boolean
}

/**
 * The follow's file name (extension-free — the shape `follow:` frontmatter
 * carries). One function names it for both the YAML on disk and the stamp in
 * every capture, so the two can never drift.
 */
export function followFileName(day: PlainDateTime, from: string, summary: string): string {
  const fromSlug = slugify(from, { preserveCase: true, suggestedLength: 30 })
  const summarySlug = slugify(summary, { preserveCase: true, suggestedLength: 40 })
  return `${day.plainDate.toString()}_email_${fromSlug}_${summarySlug}`
}

/**
 * A follow file name no other follow holds. Same sender, same day, same
 * summary slug is a real case (three same-subject forwards in one sync), and
 * persistNewFollow overwrites — without this, the second follow silently
 * replaces the first and the first thread re-captures forever. Checks names
 * already minted this run, then active/ and archive/ on disk; suffixes -2,
 * -3... like day files do. Must run where the capture stamp is computed, so
 * stamp and YAML stay locked.
 */
export async function uniqueFollowFileName(
  base: string,
  taken: Set<string>,
  isOnDisk: (fileName: string) => Promise<boolean> = followFileExists,
): Promise<string> {
  let candidate = base
  for (let n = 2; taken.has(candidate) || (await isOnDisk(candidate)); n++) {
    candidate = `${base}-${n}`
  }
  taken.add(candidate)
  return candidate
}

async function followFileExists(fileName: string): Promise<boolean> {
  return (
    (await exists(path.join(DIR_STATE_FOLLOW_EMAIL_ACTIVE, `${fileName}.yaml`))) ||
    (await exists(path.join(DIR_STATE_FOLLOW_EMAIL_ARCHIVE, `${fileName}.yaml`)))
  )
}

/** Build the follow for a first-time captured thread, anchored on the thread's real activity. */
export function planThreadFollow(opts: {
  accountEmail: string
  label: string
  thread: FetchedThread
  now: PlainDateTime
  /** Follow even when the thread is already inactive past the expiry window. */
  force?: boolean
}): PlannedFollow {
  const { accountEmail, label, thread, now, force = false } = opts

  // lastActivity is the newest message's real time, not now — a follow created
  // on a quiet thread must not look freshly active, or expiry anchors on a fiction.
  const lastActivity = thread.lastMessageAt ? PlainDateTime.fromString(thread.lastMessageAt) : now

  // The follow is labeled the way its captures are: the thread's topic summary
  // when one was produced, the subject line when it was not.
  const summary = thread.summary || thread.subject

  // The expiry probe runs on an empty-messages candidate: captured entries can
  // carry a collapsed --when date, and inactivityMs would anchor on that
  // instead of the thread's real activity.
  const candidate = Follow.create({
    source: 'Email',
    ref: { account: accountEmail, threadId: thread.threadId, label },
    summary,
    followSince: now,
    lastChecked: now,
    lastActivity,
    messages: [],
    status: 'active',
  })
  const bornExpired = !force && candidate.isExpired(now)

  let follow = bornExpired ? candidate.updateStatus('closed') : candidate
  for (const msg of thread.messages) {
    // Stored as a time ref: the follow outlives any layout the path encodes.
    follow = follow.addMessage(msg.date, toTimeRef(msg.path))
  }

  // When the fetch already stamped captures with a follow name, that name IS
  // the follow's — recomputing could drift (e.g. across midnight).
  const fileName = thread.followFile ?? followFileName(now, thread.from, summary)

  return { follow, threadId: thread.threadId, fileName, bornExpired }
}

export type PersistedFollow = { fileName: string; followed: boolean }

/**
 * Write a planned follow to disk and, when it is born expired, retire the
 * thread in Gmail (drop the bucket label + INBOX) the way inbox:close does.
 * If that Gmail call fails the follow is written active instead: an
 * archived-but-still-labeled thread would look brand new to the registry and
 * re-capture on every sync.
 */
export async function persistNewFollow(opts: {
  client: GoogleClient
  labelId: string
  planned: PlannedFollow
  output: { log: (msg: string) => void }
}): Promise<PersistedFollow> {
  const { client, labelId, planned, output } = opts
  const { threadId, fileName } = planned
  let { follow, bornExpired } = planned

  if (bornExpired) {
    try {
      await modifyThread(client, threadIdFromDecimal(threadId), { removeLabelIds: [labelId, 'INBOX'] })
    } catch (err) {
      output.log(`  Warning: could not retire thread in Gmail (${(err as Error).message}) — following instead`)
      follow = follow.updateStatus('active')
      bornExpired = false
    }
  }

  const dir = bornExpired ? DIR_STATE_FOLLOW_EMAIL_ARCHIVE : DIR_STATE_FOLLOW_EMAIL_ACTIVE
  await outputFile(path.join(dir, `${fileName}.yaml`), follow.toYaml())

  if (bornExpired) {
    output.log(`  Inactive past ${Follow.DEFAULT_MAX_INACTIVE} — captured and closed: ${fileName}`)
  } else {
    output.log(`  Created follow: ${fileName}`)
  }
  return { fileName, followed: !bornExpired }
}

/**
 * Which captured threads leave the inbox after a sync: first captures only.
 * A reply to a thread already followed is mail the owner has not read yet —
 * the capture records it, it does not stand in for it — so the thread stays
 * in the inbox until they archive it themselves. Failed threads stay so the
 * next sync retries them.
 */
export function threadsToArchive(threads: FetchedThread[], firstCaptures: Set<string>): FetchedThread[] {
  return threads.filter((t) => !t.failed && firstCaptures.has(t.threadId))
}

export type NowLabelSwap = { threadId: string; archive: boolean }

/**
 * Which Now-door threads trade their entry label for the bucket label this
 * run. A first capture swaps and leaves the inbox in one call; a continuation
 * swaps only — its reply is unread mail (threadsToArchive's rule). A listed
 * thread that is saved but was not fetched swaps too: a Now label lingering
 * on a tracked thread (a hand-labeled bump, or a swap an earlier Gmail call
 * lost) must heal, or it outlives its follow and the whole thread re-captures
 * after close-out. Failed and still-unsaved threads keep the entry label so
 * the next sync retries them.
 */
export function selectNowLabelSwaps(
  listed: { threadId: string; saved: boolean }[],
  fetched: FetchedThread[],
  firstCaptures: Set<string>,
): NowLabelSwap[] {
  const swaps: NowLabelSwap[] = []
  const fetchedIds = new Set<string>()
  for (const thread of fetched) {
    fetchedIds.add(thread.threadId)
    if (thread.failed || thread.messages.length === 0) continue
    swaps.push({ threadId: thread.threadId, archive: firstCaptures.has(thread.threadId) })
  }
  for (const thread of listed) {
    if (fetchedIds.has(thread.threadId) || !thread.saved) continue
    swaps.push({ threadId: thread.threadId, archive: false })
  }
  return swaps
}

/**
 * Apply planned Now-door swaps in Gmail: add the bucket label, drop the entry
 * label — and INBOX with it on first captures. One thread's failure is logged
 * and left alone; it stays saved (the follow exists), and the next sync's
 * lingering-label sweep retries the swap.
 */
export async function applyNowLabelSwaps(opts: {
  client: GoogleClient
  swaps: NowLabelSwap[]
  addLabelId: string
  removeLabelId: string
  output: { log: (msg: string) => void }
}): Promise<number> {
  const { client, swaps, addLabelId, removeLabelId, output } = opts
  let swapped = 0
  for (const swap of swaps) {
    try {
      await modifyThread(client, threadIdFromDecimal(swap.threadId), {
        addLabelIds: [addLabelId],
        removeLabelIds: swap.archive ? [removeLabelId, 'INBOX'] : [removeLabelId],
      })
      swapped++
    } catch (err) {
      output.log(`  Warning: label swap failed (${(err as Error).message}) — the next sync retries it`)
    }
  }
  return swapped
}

export type FollowEntry = { follow: Follow; path: string; fileName: string }

/**
 * Active follows of this account that have gone quiet past their window.
 * Follows of other accounts are left alone — their Gmail-side retire has to
 * run under their own client.
 */
export function selectExpiredFollows(entries: FollowEntry[], accountEmail: string, now: PlainDateTime): FollowEntry[] {
  const account = accountEmail.toLowerCase()
  return entries.filter(
    (e) =>
      e.follow.status === 'active' &&
      (e.follow.ref['account'] ?? '').toLowerCase() === account &&
      e.follow.isExpired(now),
  )
}

export type ExpiredFollow = {
  fileName: string
  /** The follow's own label — its topic summary — for the closing report. */
  summary: string
  /** Why it closed, in words: "inactive 43d >= 14d". */
  reason: string
}

export type ExpireSweepResult = { expired: ExpiredFollow[]; skipped: string[] }

/**
 * Close every quiet follow the way inbox:close does: retire the thread in
 * Gmail first (bucket label + INBOX), then move the YAML to archive/. On a
 * Gmail failure the follow stays active for the next sync to retry — a YAML
 * may only leave active/ once the label is confirmed gone, or the
 * still-labeled thread would re-capture as brand new.
 */
export async function expireQuietFollows(opts: {
  client: GoogleClient
  entries: FollowEntry[]
  fallbackLabel: string
  now: PlainDateTime
  output: { log: (msg: string) => void }
}): Promise<ExpireSweepResult> {
  const { client, entries, fallbackLabel, now, output } = opts
  const expired: ExpiredFollow[] = []
  const skipped: string[] = []
  const labelIds = new Map<string, string | undefined>()

  for (const entry of selectExpiredFollows(entries, client.email, now)) {
    const { follow, fileName } = entry

    const threadId = follow.ref['threadId']
    if (threadId) {
      const label = follow.ref['label'] || fallbackLabel
      if (!labelIds.has(label)) labelIds.set(label, await resolveLabelId(client, label))
      const labelId = labelIds.get(label)
      try {
        // A label that no longer exists cannot be applied to the thread, so
        // dropping INBOX alone is safe then.
        await modifyThread(client, threadIdFromDecimal(threadId), {
          removeLabelIds: labelId ? [labelId, 'INBOX'] : ['INBOX'],
        })
      } catch (err) {
        output.log(`  Warning: could not retire ${fileName} in Gmail (${(err as Error).message}) — will retry`)
        skipped.push(fileName)
        continue
      }
    }

    const inactiveMs = follow.inactivityMs(now)
    const reason = follow.expires
      ? `expires ${follow.expires.date} ${follow.expires.time} passed`
      : inactiveMs === Infinity
        ? 'no activity recorded'
        : `inactive ${Math.floor(inactiveMs / 86_400_000)}d >= ${Follow.DEFAULT_MAX_INACTIVE}`

    const closed = follow.updateStatus('closed')
    await outputFile(path.join(DIR_STATE_FOLLOW_EMAIL_ARCHIVE, `${fileName}.yaml`), closed.toYaml())
    await unlink(entry.path)
    output.log(`  Expired ${fileName}: ${reason}`)
    expired.push({ fileName, summary: follow.summary, reason })
  }

  return { expired, skipped }
}
