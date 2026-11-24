import type { GmailMessage, GmailThreadRef } from '#lib/google/gmail.ts'
import { hash } from '#lib/outbox/files.ts'
import { Instant } from '#universal/dates/nbdt/mod.ts'
import { NEEDS_RESPONSE_EXPIRY_DAYS } from './score.ts'
import { isAutomatedSender, isOwnerAuthor, isSenderEligible, resolveSender, type SenderLookup } from './sender.ts'
import type { CachedGmailThread, NeedsResponseCandidate } from './types.ts'

export const GMAIL_INBOX_THREAD_LIMIT = 50
const GMAIL_CACHE_VERSION = 2
const MAX_EMAIL_TRANSCRIPT_CHARS = 8_000
const MAX_EMAIL_SUMMARY_CHARS = 120

export interface GmailInboxClient {
  listAccounts: () => Promise<string[]>
  listThreads: (account: string, options: { q: string; limit: number }) => Promise<GmailThreadRef[]>
  getThread: (account: string, threadId: string, format: 'metadata' | 'full') => Promise<GmailMessage[]>
}

export interface ScanGmailInboxOptions {
  client: GmailInboxClient
  previousCache: Readonly<Record<string, CachedGmailThread>>
  now: Instant
  timezone: string
  ownerNames: readonly string[]
  ownerAddresses: readonly string[]
  senderLookup: SenderLookup
  lookbackDays?: number
  limitPerAccount?: number
}

export interface ScanGmailInboxResult {
  candidates: NeedsResponseCandidate[]
  nextCache: Record<string, CachedGmailThread>
  threadsChecked: number
  errors: string[]
}

function gmailThreadUrl(account: string, threadId: string): string {
  return `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(account)}#all/${encodeURIComponent(threadId)}`
}

function messageInstant(msg: GmailMessage): Instant | null {
  if (!msg.date) return null
  const ms = msg.date.getTime()
  if (!Number.isFinite(ms)) return null
  return Instant.fromEpochMilliseconds(ms)
}

function formatLocal(instant: Instant, timezone: string): string {
  const zdt = instant.toZonedDateTimeISO(timezone)
  const y = String(zdt.year).padStart(4, '0')
  const mo = String(zdt.month).padStart(2, '0')
  const d = String(zdt.day).padStart(2, '0')
  const h = String(zdt.hour).padStart(2, '0')
  const mi = String(zdt.minute).padStart(2, '0')
  return `${y}-${mo}-${d} ${h}:${mi}`
}

function isOwnerMessage(
  msg: GmailMessage,
  account: string,
  ownerNames: readonly string[],
  ownerAddresses: readonly string[],
): boolean {
  if (msg.labelIds.includes('SENT')) return true
  const addresses = [...ownerAddresses, account]
  const fromEmail = msg.from?.address?.trim()
  if (fromEmail && isOwnerAuthor(fromEmail, ownerNames, addresses)) return true
  const fromName = msg.from?.name?.trim()
  if (fromName && isOwnerAuthor(fromName, ownerNames, addresses)) return true
  return false
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

function cleanBody(msg: GmailMessage): string {
  const raw = msg.bodyText?.trim() || (msg.bodyHtml ? stripHtml(msg.bodyHtml) : '') || msg.snippet?.trim() || ''
  // Trim quoted reply chains (lines starting with ">") so Jev focuses on the actual new content.
  const withoutQuotes = raw
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith('>'))
    .join('\n')
    .trim()
  return (withoutQuotes || raw).slice(0, 2_500)
}

function emailSummary(subject: string | undefined, snippet: string | undefined): string {
  const cleanSubject = (subject ?? '').replace(/^(?:(?:re|fwd|fw)\s*:\s*)+/i, '').trim()
  const cleanSnippet = (snippet ?? '').replace(/\s+/g, ' ').trim()
  const chosen = cleanSubject || cleanSnippet || '(No subject)'
  if (chosen.length <= MAX_EMAIL_SUMMARY_CHARS) return chosen
  return `${chosen.slice(0, MAX_EMAIL_SUMMARY_CHARS - 1).trimEnd()}…`
}

function buildEmailTranscript(messages: readonly GmailMessage[], timezone: string): string {
  const recent = messages.slice(-6)
  const parts = recent.map((msg) => {
    const instant = messageInstant(msg)
    const when = instant ? formatLocal(instant, timezone) : ''
    const from = msg.from?.name || msg.from?.address || 'Unknown'
    const subject = msg.subject ? `Subject: ${msg.subject}\n` : ''
    return `[${when}] ${from}:\n${subject}${cleanBody(msg)}`
  })
  const joined = parts.join('\n\n---\n\n')
  if (joined.length <= MAX_EMAIL_TRANSCRIPT_CHARS) return joined
  return joined.slice(joined.length - MAX_EMAIL_TRANSCRIPT_CHARS)
}

/**
 * Read-only scan of every connected Gmail account's `INBOX` over the rolling 7-day window.
 *
 * Does NOT require a `sky/follow` label and never modifies Gmail labels or drafts.
 * Uses `thread.historyId` caching so unchanged threads cost zero `getThread` calls.
 */
export async function scanGmailInbox(options: ScanGmailInboxOptions): Promise<ScanGmailInboxResult> {
  const lookbackDays = options.lookbackDays ?? NEEDS_RESPONSE_EXPIRY_DAYS
  const limitPerAccount = options.limitPerAccount ?? GMAIL_INBOX_THREAD_LIMIT
  const cutoffMs = options.now.epochMilliseconds - lookbackDays * 24 * 3_600_000
  const pruneBeforeMs = options.now.epochMilliseconds - 14 * 24 * 3_600_000
  const nowStr = options.now.toString()

  const nextCache: Record<string, CachedGmailThread> = {}
  for (const [key, entry] of Object.entries(options.previousCache)) {
    try {
      if (Instant.from(entry.checkedAt).epochMilliseconds >= pruneBeforeMs) {
        nextCache[key] = entry
      }
    } catch {
      // Drop malformed timestamps
    }
  }

  const candidates: NeedsResponseCandidate[] = []
  const errors: string[] = []
  let threadsChecked = 0

  let accounts: string[]
  try {
    accounts = await options.client.listAccounts()
  } catch (error) {
    return {
      candidates: [],
      nextCache,
      threadsChecked: 0,
      errors: [error instanceof Error ? error.message : String(error)],
    }
  }

  const query = `in:inbox newer_than:${lookbackDays}d`

  for (const account of accounts) {
    const accountKey = account.toLowerCase()
    let refs: GmailThreadRef[]
    try {
      refs = await options.client.listThreads(account, { q: query, limit: limitPerAccount })
    } catch (error) {
      errors.push(`Gmail (${account}): ${error instanceof Error ? error.message : String(error)}`)
      continue
    }

    const seenInInbox = new Set<string>()

    for (const ref of refs) {
      const id = `Email:${accountKey}:${ref.id}`
      seenInInbox.add(id)

      // Fast path: unchanged historyId + cache version reuses the cached classification without fetching the thread.
      const cached = nextCache[id]
      if (
        cached &&
        ref.historyId &&
        cached.historyId === ref.historyId &&
        cached.cacheVersion === GMAIL_CACHE_VERSION
      ) {
        if (cached.status === 'active' && cached.candidate) {
          const received = Instant.from(cached.candidate.receivedAt)
          if (received.epochMilliseconds >= cutoffMs) {
            candidates.push(cached.candidate)
          }
        }
        continue
      }

      threadsChecked++
      let metaMessages: GmailMessage[]
      try {
        metaMessages = await options.client.getThread(account, ref.id, 'metadata')
      } catch (error) {
        errors.push(`Gmail (${account}) thread ${ref.id}: ${error instanceof Error ? error.message : String(error)}`)
        continue
      }

      const historyId = ref.historyId ?? hash(metaMessages.map((m) => m.id).join(','))
      const nonDrafts = metaMessages.filter((m) => !m.labelIds.includes('DRAFT'))
      if (nonDrafts.length === 0) {
        nextCache[id] = { historyId, status: 'ignored', checkedAt: nowStr, cacheVersion: GMAIL_CACHE_VERSION }
        continue
      }

      const lastMsg = nonDrafts.at(-1)!
      const lastInstant = messageInstant(lastMsg)
      if (!lastInstant || lastInstant.epochMilliseconds < cutoffMs) {
        nextCache[id] = { historyId, status: 'ignored', checkedAt: nowStr, cacheVersion: GMAIL_CACHE_VERSION }
        continue
      }

      // Auto-clear: owner sent the most recent message in this thread.
      if (isOwnerMessage(lastMsg, account, options.ownerNames, options.ownerAddresses)) {
        nextCache[id] = { historyId, status: 'replied', checkedAt: nowStr, cacheVersion: GMAIL_CACHE_VERSION }
        continue
      }

      if (
        isAutomatedSender({
          name: lastMsg.from?.name,
          email: lastMsg.from?.address,
          labels: lastMsg.labelIds,
        })
      ) {
        nextCache[id] = { historyId, status: 'ignored', checkedAt: nowStr, cacheVersion: GMAIL_CACHE_VERSION }
        continue
      }

      const ownerParticipated = nonDrafts.some((m) =>
        isOwnerMessage(m, account, options.ownerNames, options.ownerAddresses),
      )
      const resolved = resolveSender({ name: lastMsg.from?.name, email: lastMsg.from?.address }, options.senderLookup)
      if (!isSenderEligible({ registered: resolved.registered, ownerParticipated })) {
        nextCache[id] = { historyId, status: 'unregistered', checkedAt: nowStr, cacheVersion: GMAIL_CACHE_VERSION }
        continue
      }

      // Fetch full bodies only for surviving human inbox threads from registered/engaged senders.
      let fullMessages: GmailMessage[]
      try {
        fullMessages = (await options.client.getThread(account, ref.id, 'full')).filter(
          (m) => !m.labelIds.includes('DRAFT'),
        )
      } catch (error) {
        errors.push(`Gmail (${account}) thread ${ref.id}: ${error instanceof Error ? error.message : String(error)}`)
        continue
      }
      const fullLast = fullMessages.at(-1) ?? lastMsg
      const subject = fullLast.subject || fullMessages[0]?.subject
      const version = hash(JSON.stringify({ id: fullLast.id, historyId })).slice(0, 16)

      const candidate: NeedsResponseCandidate = {
        id,
        version,
        source: 'Gmail',
        medium: 'Email',
        kind: 'inbox',
        senderName: fullLast.from?.name || fullLast.from?.address || 'Unknown',
        ...(fullLast.from?.address ? { senderEmail: fullLast.from.address } : {}),
        summary: emailSummary(subject, fullLast.snippet ?? ref.snippet),
        receivedAt: lastInstant.toString(),
        receivedLocal: formatLocal(lastInstant, options.timezone),
        ownerParticipated,
        transcript: buildEmailTranscript(fullMessages, options.timezone),
        target: {
          medium: 'Email',
          account,
          thread: ref.id,
          link: gmailThreadUrl(account, ref.id),
        },
      }

      nextCache[id] = {
        historyId,
        status: 'active',
        checkedAt: nowStr,
        cacheVersion: GMAIL_CACHE_VERSION,
        candidate,
      }
      candidates.push(candidate)
    }

    // Threads archived out of INBOX drop out of cached active state automatically.
    const prefix = `Email:${accountKey}:`
    for (const [key, entry] of Object.entries(nextCache)) {
      if (key.startsWith(prefix) && entry.status === 'active' && !seenInInbox.has(key)) {
        delete nextCache[key]
      }
    }
  }

  return { candidates, nextCache, threadsChecked, errors }
}
