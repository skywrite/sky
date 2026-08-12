import type { GoogleClient } from '#lib/google/mod.ts'
import { getThread, listThreads, modifyThread, resolveLabelId, threadIdToDecimal } from '#lib/google/mod.ts'
import type { GmailMessage } from '#lib/google/mod.ts'
import EmailFollowRegistry from '#shared/models/Follow/EmailFollowRegistry.ts'

// Gmail-API twin of email/lib/getInboxThreads.ts. The IMAP original scans the
// label folder plus the whole INBOX to reunite threads with unlabeled replies;
// here threads.get already returns every message of a thread, so the reply
// hunt (and the per-mailbox `source` bookkeeping) has no equivalent.

/** A thread message plus whether it has been saved to disk already. */
export type InboxMessage = GmailMessage & {
  saved: boolean
}

export type InboxThread = {
  /** Decimal rendering (the X-GM-THRID form follow files store). */
  threadId: string
  /** Gmail API (hex) id for follow-up API calls on this thread. */
  apiThreadId: string
  messages: InboxMessage[]
  /** Whether every message of this thread is already saved to disk. */
  saved: boolean
  /** Recorded message entries from the follow (dates already on disk). */
  savedMessages: { date: string; path: string }[]
}

export type InboxThreadsResult = {
  threads: InboxThread[]
  savedCount: number
  unsavedCount: number
  /** Resolved API id of the label, for later modify calls without a second lookup. */
  labelId: string
}

/**
 * Whether a message counts as saved given its follow's lastActivity cutoff.
 * lastActivity is minute-granular (follow YAML carries no seconds) while Gmail
 * dates do — the newest saved message sorts after its own truncated cutoff, so
 * the whole cutoff minute counts as saved. A second message landing later
 * within that same minute is never fetched: the minute-granularity blind spot
 * slack:follow:check also accepts.
 */
export function savedByCutoff(msgDate: Date, lastActivity: Date): boolean {
  return msgDate.getTime() < lastActivity.getTime() + 60_000
}

/**
 * Get all threads carrying a Gmail label, grouped and marked as saved/unsaved
 * against the follow registry. Shared between google:email:inbox:view
 * (display) and google:email:inbox:fetch (download). `limit` counts threads
 * (the IMAP original counted messages).
 */
export async function getInboxThreads(
  client: GoogleClient,
  label: string,
  opts: { limit?: number } = {},
): Promise<InboxThreadsResult> {
  const { limit = 250 } = opts

  const labelId = await resolveLabelId(client, label)
  if (!labelId) {
    throw new Error(`Gmail label "${label}" not found for ${client.email}`)
  }

  const refs = await listThreads(client, { labelIds: [labelId], limit })

  const threadEntries: { threadId: string; apiThreadId: string; messages: InboxMessage[] }[] = []
  for (const ref of refs) {
    const messages = await getThread(client, ref.id, { format: 'metadata' })
    if (messages.length === 0) continue

    // Gmail labels are per-message: new replies to a labeled thread don't
    // inherit the label, and archiving would make them unfindable under it.
    // The IMAP original copied INBOX replies into the label folder; here one
    // thread-level add labels every message.
    if (messages.some((m) => !m.labelIds.includes(labelId))) {
      try {
        await modifyThread(client, ref.id, { addLabelIds: [labelId] })
      } catch {
        // Labeling is persistence hygiene, not a prerequisite for listing.
      }
    }

    threadEntries.push({
      threadId: threadIdToDecimal(ref.id),
      apiThreadId: ref.id,
      messages: messages.map((m) => ({ ...m, saved: false })),
    })
  }

  // Sort each thread's messages oldest-first
  for (const entry of threadEntries) {
    entry.messages.sort((a, b) => {
      const dateA = a.date ? a.date.getTime() : 0
      const dateB = b.date ? b.date.getTime() : 0
      return dateA - dateB
    })
  }

  // Load follow registry to determine saved status
  const followMessages = new Map<string, { date: string; path: string }[]>()
  const followLastActivity = new Map<string, Date>()
  const registry = await EmailFollowRegistry.build()
  for (const entry of registry.getAll()) {
    const tid = entry.follow.ref.threadId
    if (!tid) continue
    followMessages.set(tid, entry.follow.messages)
    if (entry.follow.lastActivity) {
      followLastActivity.set(tid, new Date(entry.follow.lastActivity.toString().replace(' ', 'T')))
    }
  }

  // Mark per-message saved status based on follow lastActivity
  for (const entry of threadEntries) {
    const cutoff = followLastActivity.get(entry.threadId)
    if (!cutoff) continue
    for (const msg of entry.messages) {
      msg.saved = !!msg.date && savedByCutoff(msg.date, cutoff)
    }
  }

  // Sort threads by most recent message (newest first)
  threadEntries.sort((a, b) => {
    const aLatest = Math.max(...a.messages.map((m) => (m.date ? m.date.getTime() : 0)))
    const bLatest = Math.max(...b.messages.map((m) => (m.date ? m.date.getTime() : 0)))
    return bLatest - aLatest
  })

  const threads: InboxThread[] = []
  let savedCount = 0
  let unsavedCount = 0

  for (const entry of threadEntries) {
    const saved = entry.messages.length > 0 && entry.messages.every((m) => m.saved)
    if (saved) savedCount++
    else unsavedCount++

    threads.push({
      threadId: entry.threadId,
      apiThreadId: entry.apiThreadId,
      messages: entry.messages,
      saved,
      savedMessages: followMessages.get(entry.threadId) ?? [],
    })
  }

  return { threads, savedCount, unsavedCount, labelId }
}
