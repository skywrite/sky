import { unlink } from 'node:fs/promises'
import * as path from 'node:path'
import { DIR_STATE_FOLLOW_EMAIL_ACTIVE, DIR_STATE_FOLLOW_EMAIL_ARCHIVE } from '#config'
import { modifyThread, resolveLabelId, threadIdFromDecimal } from '#lib/google/mod.ts'
import type { GoogleClient } from '#lib/google/mod.ts'
import slugify from '#lib/string/slugify.ts'
import { outputFile } from '#shared/fs/mod.ts'
import Follow from '#shared/models/Follow/mod.ts'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import type { FetchedThread } from './fetchUnsavedThreads.ts'

// First-time follow creation, shared by follow:new and follow:sync. Mirrors
// slack:follow:new's decline rule: a thread already quiet past the expiry
// window is an archive, not something to watch — its content is captured, but
// the follow is born closed and the thread leaves the Sky/Follow bucket.

export type PlannedFollow = {
  follow: Follow
  threadId: string
  fileName: string
  /** Thread was already inactive past the expiry window at capture time. */
  bornExpired: boolean
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
    follow = follow.addMessage(msg.date, msg.path)
  }

  const fromSlug = slugify(thread.from, { preserveCase: true, suggestedLength: 30 })
  const summarySlug = slugify(summary, { preserveCase: true, suggestedLength: 40 })
  const fileName = `${now.plainDate.toString()}_email_${fromSlug}_${summarySlug}`

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

export type ExpireSweepResult = { expired: string[]; skipped: string[] }

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
  const expired: string[] = []
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
    expired.push(fileName)
  }

  return { expired, skipped }
}
