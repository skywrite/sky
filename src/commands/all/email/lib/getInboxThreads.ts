import EmailFollowRegistry from '#shared/models/Follow/EmailFollowRegistry.ts'
import { fetchFromLabel, findInboxReplies, parseMessage } from './imap-client.ts'
import type { EmailMessage } from './imap-client.ts'
import type { ImapFlow } from 'imapflow'

/** A message with its source mailbox tracked for later downloading */
export type InboxMessage = EmailMessage & {
  /** Which mailbox this message's UID belongs to */
  source: 'label' | 'inbox'
  /** Whether this individual message has been saved to disk */
  saved: boolean
}

export type InboxThread = {
  threadId: string
  messages: InboxMessage[]
  /** Whether this thread has a follow on disk (content already saved) */
  saved: boolean
  /** Recorded message entries from the follow (dates already on disk) */
  savedMessages: { date: string; path: string }[]
}

export type InboxThreadsResult = {
  threads: InboxThread[]
  savedCount: number
  unsavedCount: number
}

/**
 * Get all threads from a Gmail label + INBOX replies, grouped and marked as saved/unsaved.
 * Shared between email:inbox:view (display) and email:inbox:fetch (download).
 */
export async function getInboxThreads(
  client: ImapFlow,
  label: string,
  opts: { since?: Date; limit?: number; debug?: boolean } = {},
): Promise<InboxThreadsResult> {
  const { since, limit = 50, debug = false } = opts
  const log = debug ? (msg: string) => console.error(`  [debug] ${msg}`) : (_msg: string) => {}

  // Fetch metadata from label (fast, no body)
  const labelMessages = await fetchFromLabel(client, label, {
    since,
    limit,
    skipSource: true,
    debug,
  })

  log(`fetchFromLabel("${label}"): ${labelMessages.length} message(s)`)
  for (const m of labelMessages) {
    const from = m.from?.name || m.from?.address || '?'
    const date = m.date ? m.date.toISOString().slice(0, 10) : '?'
    log(`  label UID=${m.uid} tid=${m.threadId} ${date} ${from} mid=${m.messageId}`)
  }

  // Tag with source (saved determined later after loading follow registry)
  const tagged: InboxMessage[] = labelMessages.map((m) => ({ ...m, source: 'label' as const, saved: false }))

  // Find thread replies in All Mail (labels are per-message in IMAP;
  // new replies to a labeled thread don't inherit the label)
  const threadIds = new Set<string>()
  for (const msg of labelMessages) {
    if (msg.threadId) threadIds.add(msg.threadId)
  }

  log(`Label threadIds: ${[...threadIds].join(', ')}`)

  if (threadIds.size > 0) {
    const excludeIds = new Set(labelMessages.map((m) => m.messageId).filter((id): id is string => !!id))

    // Find thread replies in INBOX and label them so they persist.
    // Gmail IMAP labels are per-message, not per-conversation — new replies
    // to a labeled thread don't inherit the label. We fix that here.
    let oldestDate: Date | undefined
    for (const msg of labelMessages) {
      if (msg.date && (!oldestDate || msg.date < oldestDate)) {
        oldestDate = msg.date
      }
    }

    log(`Scanning INBOX since=${oldestDate?.toISOString()}, excluding ${excludeIds.size} messageIds`)

    const replies = await findInboxReplies(client, 'INBOX', threadIds, {
      since: oldestDate,
      excludeMessageIds: excludeIds,
      debug,
    })

    log(`INBOX replies: ${replies.length}`)

    // Label discovered replies with Sky/Follow so they persist after archiving
    if (replies.length > 0) {
      const replyUids = replies.map((r) => r.uid)
      try {
        const inboxLock = await client.getMailboxLock('INBOX')
        try {
          await client.messageCopy(replyUids.join(','), label, { uid: true })
          log(`Labeled ${replyUids.length} INBOX reply(s) with "${label}"`)
        } finally {
          inboxLock.release()
        }
      } catch (err) {
        log(`Warning: failed to label replies: ${(err as Error).message}`)
      }
    }

    for (const r of replies) {
      const from = r.from?.name || r.from?.address || '?'
      const date = r.date ? r.date.toISOString().slice(0, 10) : '?'
      log(`  UID=${r.uid} tid=${r.threadId} ${date} ${from}`)
      tagged.push({ ...r, source: 'inbox' as const, saved: false })
    }
  }

  // Group by thread
  const threadMap = new Map<string, InboxMessage[]>()
  for (const msg of tagged) {
    const tid = msg.threadId || `_solo_${msg.uid}`
    const group = threadMap.get(tid) ?? []
    group.push(msg)
    threadMap.set(tid, group)
  }

  // Sort each thread's messages oldest-first
  for (const msgs of threadMap.values()) {
    msgs.sort((a, b) => {
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
  for (const msgs of threadMap.values()) {
    const tid = msgs[0]?.threadId
    if (!tid) continue
    const cutoff = followLastActivity.get(tid)
    if (!cutoff) continue
    for (const msg of msgs) {
      msg.saved = !!msg.date && msg.date <= cutoff
    }
  }

  // Build result threads
  const threads: InboxThread[] = []
  let savedCount = 0
  let unsavedCount = 0

  // Sort threads by most recent message (newest first)
  const sortedEntries = [...threadMap.entries()]
  sortedEntries.sort((a, b) => {
    const aLatest = Math.max(...a[1].map((m) => (m.date ? m.date.getTime() : 0)))
    const bLatest = Math.max(...b[1].map((m) => (m.date ? m.date.getTime() : 0)))
    return bLatest - aLatest
  })

  for (const [threadId, messages] of sortedEntries) {
    const saved = messages.length > 0 && messages.every((m) => m.saved)
    if (saved) savedCount++
    else unsavedCount++

    threads.push({
      threadId,
      messages,
      saved,
      savedMessages: followMessages.get(threadId) ?? [],
    })
  }

  return { threads, savedCount, unsavedCount }
}
