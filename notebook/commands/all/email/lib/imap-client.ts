import { Buffer } from 'node:buffer'
import { ImapFlow } from 'imapflow'
import type { FetchMessageObject, MessageEnvelopeObject } from 'imapflow'

export type EmailAttachmentMeta = {
  partId: string
  filename: string
  contentType: string
  size: number
}

export type EmailMessage = {
  uid: number
  threadId?: string
  date?: Date
  subject?: string
  from?: { name?: string; address?: string }
  to?: { name?: string; address?: string }[]
  cc?: { name?: string; address?: string }[]
  messageId?: string
  inReplyTo?: string
  bodyText: string
  bodyHtml?: string
  attachments?: EmailAttachmentMeta[]
  labels?: string[]
}

type FetchOptions = {
  since?: Date
  limit?: number
  /** Skip fetching full email source (faster, for metadata-only use) */
  skipSource?: boolean
}

/**
 * Connect to Gmail IMAP with app password credentials.
 */
type ImapClientOptions = {
  user: string
  pass: string
  host?: string
  port?: number
}

export function createImapClient(opts: ImapClientOptions): ImapFlow {
  const host = opts.host ?? 'imap.gmail.com'
  const port = opts.port ?? 993
  return new ImapFlow({
    host,
    port,
    secure: true,
    auth: { user: opts.user, pass: opts.pass },
    logger: false,
    tls: { servername: host },
    // Disable IMAP COMPRESS — Deno's zlib InflateRaw throws "invalid block type"
    disableCompression: true,
    // Deno's TLS is slower than Node; default timeout is too aggressive
    socketTimeout: 5 * 60 * 1000,
  })
}

/**
 * Fetch emails from a Gmail label (IMAP folder).
 * Returns newest-first, up to `limit` messages.
 */
export async function fetchFromLabel(
  client: ImapFlow,
  label: string,
  opts: FetchOptions & { debug?: boolean } = {},
): Promise<EmailMessage[]> {
  const { since, limit = 10, skipSource = false, debug = false } = opts
  const log = debug ? (msg: string) => console.error(`  [debug:fetchFromLabel] ${msg}`) : (_msg: string) => {}
  const fetchFields = {
    envelope: true,
    source: !skipSource,
    threadId: true,
    bodyStructure: true,
    labels: true,
  }

  const lock = await client.getMailboxLock(label)
  try {
    // Search for messages (optionally filtered by date)
    const searchQuery = since ? { since } : { all: true }
    const uids = await client.search(searchQuery, { uid: true })
    const uidList = Array.isArray(uids) ? uids : []
    log(`SEARCH ALL in "${label}": ${uidList.length} UIDs = [${uidList.join(', ')}]`)
    if (uidList.length === 0) return []

    // Take the newest N messages (highest UIDs = newest)
    const sorted = [...uidList].sort((a, b) => b - a)
    const selected = sorted.slice(0, limit)
    log(`Selected ${selected.length} of ${sorted.length} (limit=${limit})`)

    const messages: EmailMessage[] = []

    for (const uid of selected) {
      const msg = await client.fetchOne(String(uid), fetchFields, { uid: true })
      if (!msg) continue
      messages.push(parseMessage(msg))
    }

    return messages
  } finally {
    lock.release()
  }
}

/**
 * Fetch emails from a label where UID > minUid (delta fetch).
 * Returns oldest-first (chronological) for chaining `previous` links.
 */
export async function fetchSinceUid(
  client: ImapFlow,
  label: string,
  minUid: number,
  opts: { skipSource?: boolean } = {},
): Promise<EmailMessage[]> {
  const { skipSource = false } = opts
  const fetchFields = { envelope: true, source: !skipSource, threadId: true, bodyStructure: true }

  const lock = await client.getMailboxLock(label)
  try {
    // UID range: minUid+1 to * (all newer than minUid)
    const uids = await client.search({ uid: `${minUid + 1}:*` }, { uid: true })
    if (!uids || uids.length === 0) return []

    // Filter out minUid itself (IMAP returns it if range start > max UID)
    const filtered = uids.filter((uid) => uid > minUid)
    if (filtered.length === 0) return []

    // Sort oldest-first (ascending UID) for chronological processing
    const sorted = [...filtered].sort((a, b) => a - b)

    const messages: EmailMessage[] = []
    for (const uid of sorted) {
      const msg = await client.fetchOne(String(uid), fetchFields, { uid: true })
      if (!msg) continue
      messages.push(parseMessage(msg))
    }

    return messages
  } finally {
    lock.release()
  }
}

/**
 * Remove a Gmail label from messages by UID.
 * Uses Gmail's X-GM-LABELS IMAP extension.
 */
export async function removeLabel(client: ImapFlow, label: string, uids: number[]): Promise<void> {
  if (uids.length === 0) return
  const lock = await client.getMailboxLock(label)
  try {
    const uidSet = uids.join(',')
    await client.messageFlagsRemove({ uid: uidSet }, [label], { uid: true, useLabels: true })
  } finally {
    lock.release()
  }
}

/**
 * Download an attachment by UID and part ID.
 * Caller MUST hold the mailbox lock — this does not acquire its own.
 * Returns the raw Buffer content, or undefined if download fails.
 */
export async function downloadAttachment(client: ImapFlow, uid: number, partId: string): Promise<Buffer | undefined> {
  const { content } = await client.download(String(uid), partId, { uid: true })
  const chunks: Buffer[] = []
  for await (const chunk of content) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

export type DownloadedFile = { filename: string; data: Buffer }

export type FetchedEmailMessage = EmailMessage & {
  downloadedAttachments: DownloadedFile[]
}

/**
 * Fetch messages and download their attachments in a single mailbox lock session.
 * This prevents socket timeouts caused by releasing and re-acquiring the lock.
 */
export async function fetchAndDownload(
  client: ImapFlow,
  label: string,
  opts: { minUid?: number; limit?: number; onProgress?: (msg: string) => void },
): Promise<FetchedEmailMessage[]> {
  const { minUid, limit = 10, onProgress } = opts
  // Don't fetch `source` — it downloads the entire raw email including base64
  // attachments, which can be huge and cause hangs. Instead, fetch bodyStructure
  // to find the text part ID, then download just that part.
  const fetchFields = { envelope: true, source: false, threadId: true, bodyStructure: true }

  onProgress?.(`  Opening mailbox "${label}"...`)
  const lock = await client.getMailboxLock(label)
  try {
    // Search for UIDs
    onProgress?.(`  Searching for messages...`)
    let uids: number[]
    if (minUid != null && minUid > 0) {
      const found = await client.search({ uid: `${minUid + 1}:*` }, { uid: true })
      if (!found || !Array.isArray(found)) return []
      uids = found.filter((uid) => uid > minUid)
    } else {
      const found = await client.search({ all: true }, { uid: true })
      if (!found || !Array.isArray(found)) return []
      uids = found
    }

    if (uids.length === 0) return []

    // Always oldest-first so --limit N processes the next N chronologically
    uids.sort((a, b) => a - b)
    uids = uids.slice(0, limit)

    onProgress?.(`  Found ${uids.length} message(s) to fetch`)

    const results: FetchedEmailMessage[] = []

    for (const uid of uids) {
      onProgress?.(`  Fetching UID ${uid} (${results.length + 1}/${uids.length})...`)
      const msg = await client.fetchOne(String(uid), fetchFields, { uid: true })
      if (!msg) continue

      const parsed = parseMessage(msg)

      // Download just the text body part (not the full source)
      const textPartId = findTextPartId(msg.bodyStructure)
      if (textPartId) {
        try {
          const buf = await downloadAttachment(client, uid, textPartId)
          if (buf) parsed.bodyText = buf.toString('utf-8')
        } catch {
          onProgress?.(`  Failed to download text part for UID ${uid}`)
        }
      }

      // Download attachments while lock is held
      const downloadedAttachments: DownloadedFile[] = []
      if (parsed.attachments && parsed.attachments.length > 0) {
        for (const att of parsed.attachments) {
          try {
            const data = await downloadAttachment(client, uid, att.partId)
            if (data && data.length > 0) {
              downloadedAttachments.push({ filename: att.filename, data })
              onProgress?.(`  Downloaded: ${att.filename} (${Math.round(data.length / 1024)}KB)`)
            }
          } catch (err) {
            onProgress?.(`  Attachment download failed (${att.filename}): ${(err as Error).message}`)
          }
        }
      }

      results.push({ ...parsed, downloadedAttachments })
    }

    return results
  } finally {
    lock.release()
  }
}

/**
 * Download body text + attachments for specific message UIDs in a mailbox.
 * Used by email:inbox:fetch to download content for targeted messages only.
 */
export async function downloadMessageBodies(
  client: ImapFlow,
  mailbox: string,
  uids: number[],
  opts: { onProgress?: (msg: string) => void } = {},
): Promise<FetchedEmailMessage[]> {
  if (uids.length === 0) return []

  const { onProgress } = opts
  const lock = await client.getMailboxLock(mailbox)
  try {
    const results: FetchedEmailMessage[] = []

    for (const uid of uids) {
      if (!client.usable) {
        onProgress?.(`  Connection lost — returning ${results.length} message(s) downloaded so far`)
        break
      }

      onProgress?.(`  Downloading UID ${uid} (${results.length + 1}/${uids.length})...`)
      const msg = await client.fetchOne(
        String(uid),
        { envelope: true, threadId: true, bodyStructure: true, labels: true },
        { uid: true },
      )
      if (!msg) continue

      const parsed = parseMessage(msg)

      // Download text body part (prefer text/plain, fall back to text/html)
      const textPartId = findTextPartId(msg.bodyStructure)
      if (textPartId) {
        try {
          const buf = await downloadAttachment(client, uid, textPartId)
          if (buf) parsed.bodyText = buf.toString('utf-8')
        } catch {
          onProgress?.(`  Failed to download text part for UID ${uid}`)
        }
      }

      // Also download text/html as fallback (text/plain may be only quoted text)
      const htmlPartId = findHtmlPartId(msg.bodyStructure)
      if (htmlPartId) {
        try {
          const buf = await downloadAttachment(client, uid, htmlPartId)
          if (buf) parsed.bodyHtml = buf.toString('utf-8')
        } catch {
          /* HTML fallback is best-effort */
        }
      }

      // Download attachments
      const downloadedAttachments: DownloadedFile[] = []
      if (parsed.attachments && parsed.attachments.length > 0) {
        for (const att of parsed.attachments) {
          try {
            const data = await downloadAttachment(client, uid, att.partId)
            if (data && data.length > 0) {
              downloadedAttachments.push({ filename: att.filename, data })
              onProgress?.(`  Downloaded: ${att.filename} (${Math.round(data.length / 1024)}KB)`)
            }
          } catch (err) {
            onProgress?.(`  Attachment download failed (${att.filename}): ${(err as Error).message}`)
          }
        }
      }

      results.push({ ...parsed, downloadedAttachments })
    }

    return results
  } finally {
    lock.release()
  }
}

/**
 * Fetch only NEW messages from a label by comparing against already-processed messageIds.
 * Phase 1: batch-fetch metadata (fast), filter out processed.
 * Phase 2: download text + attachments only for new messages.
 * Returns chronologically sorted results.
 */
export async function fetchNewFromLabel(
  client: ImapFlow,
  label: string,
  opts: {
    processedMessageIds?: Set<string>
    limit?: number
    onProgress?: (msg: string) => void
  } = {},
): Promise<FetchedEmailMessage[]> {
  const { processedMessageIds = new Set(), limit, onProgress } = opts

  onProgress?.(`  Opening "${label}"...`)
  const lock = await client.getMailboxLock(label)
  try {
    const uids = await client.search({ all: true }, { uid: true })
    if (!uids || uids.length === 0) return []

    onProgress?.(`  Scanning ${uids.length} message(s) in "${label}"...`)

    // Phase 1: Batch fetch metadata to find new messages
    // deno-lint-ignore no-explicit-any
    const toDownload: { parsed: EmailMessage; uid: number; bodyStructure: any }[] = []
    const uidRange = uids.join(',')

    for await (const msg of client.fetch(
      uidRange,
      { envelope: true, threadId: true, bodyStructure: true, labels: true },
      { uid: true },
    )) {
      const parsed = parseMessage(msg)
      if (parsed.messageId && processedMessageIds.has(parsed.messageId)) continue
      toDownload.push({ parsed, uid: msg.uid, bodyStructure: msg.bodyStructure })
    }

    if (toDownload.length === 0) {
      onProgress?.('  No new messages.')
      return []
    }

    // Sort chronologically (oldest first)
    toDownload.sort((a, b) => {
      const dateA = a.parsed.date instanceof Date ? a.parsed.date.getTime() : 0
      const dateB = b.parsed.date instanceof Date ? b.parsed.date.getTime() : 0
      return dateA - dateB
    })

    // Apply limit
    const batch = limit ? toDownload.slice(0, limit) : toDownload
    onProgress?.(`  Fetching ${batch.length} new message(s)...`)

    // Phase 2: Download content for new messages
    const results: FetchedEmailMessage[] = []

    for (const { parsed, uid, bodyStructure } of batch) {
      onProgress?.(`  Downloading ${results.length + 1}/${batch.length}...`)

      const textPartId = findTextPartId(bodyStructure)
      if (textPartId) {
        try {
          const buf = await downloadAttachment(client, uid, textPartId)
          if (buf) parsed.bodyText = buf.toString('utf-8')
        } catch {
          onProgress?.(`  Failed to download text part for UID ${uid}`)
        }
      }

      const downloadedAttachments: DownloadedFile[] = []
      if (parsed.attachments && parsed.attachments.length > 0) {
        for (const att of parsed.attachments) {
          try {
            const data = await downloadAttachment(client, uid, att.partId)
            if (data && data.length > 0) {
              downloadedAttachments.push({ filename: att.filename, data })
              onProgress?.(`  Downloaded: ${att.filename} (${Math.round(data.length / 1024)}KB)`)
            }
          } catch (err) {
            onProgress?.(`  Attachment download failed (${att.filename}): ${(err as Error).message}`)
          }
        }
      }

      results.push({ ...parsed, downloadedAttachments })
    }

    return results
  } finally {
    lock.release()
  }
}

/**
 * Remove the \Inbox label from messages (archive them from Gmail inbox).
 * Uses Gmail's X-GM-LABELS IMAP extension.
 * @param mailbox - The mailbox context (UIDs must be valid in this mailbox)
 */
export async function archiveMessages(client: ImapFlow, mailbox: string, uids: number[]): Promise<void> {
  if (uids.length === 0) return
  const lock = await client.getMailboxLock(mailbox)
  try {
    const uidSet = uids.join(',')
    await client.messageFlagsRemove({ uid: uidSet }, ['\\Inbox'], { uid: true, useLabels: true })
  } finally {
    lock.release()
  }
}

/**
 * Search a mailbox for messages belonging to specific threads.
 * Batch-fetches metadata, then optionally downloads content and archives.
 *
 * - Default (no options): metadata-only, fast, for display
 * - download: true — also fetches text body + attachments
 * - archive: true — removes \Inbox from matched messages
 */
export async function findInboxReplies(
  client: ImapFlow,
  mailbox: string,
  threadIds: Set<string>,
  opts: {
    since?: Date
    excludeMessageIds?: Set<string>
    download?: boolean
    archive?: boolean
    onProgress?: (msg: string) => void
    debug?: boolean
  } = {},
): Promise<FetchedEmailMessage[]> {
  const { since, excludeMessageIds = new Set(), download = false, archive = false, onProgress, debug = false } = opts
  const dbg = debug ? (msg: string) => console.error(`  [debug:findInboxReplies] ${msg}`) : (_msg: string) => {}

  if (threadIds.size === 0) return []

  onProgress?.(`  Scanning ${mailbox} for replies to tracked threads...`)
  const lock = await client.getMailboxLock(mailbox)
  try {
    const searchQuery = since ? { since } : { all: true }
    dbg(`SEARCH in "${mailbox}" since=${since?.toISOString() ?? 'all'}`)
    const rawUids = await client.search(searchQuery, { uid: true })
    const uids = Array.isArray(rawUids) ? rawUids : []
    dbg(`SEARCH returned ${uids.length} UIDs`)
    if (uids.length === 0) {
      onProgress?.(`  No messages to scan in ${mailbox}.`)
      return []
    }

    onProgress?.(`  Scanning ${uids.length} message(s) in ${mailbox}...`)

    // Phase 1: Batch fetch metadata to find matching messages
    // deno-lint-ignore no-explicit-any
    const toDownload: { parsed: EmailMessage; uid: number; bodyStructure: any }[] = []
    const archiveUids: number[] = []
    const uidRange = uids.join(',')

    for await (const msg of client.fetch(
      uidRange,
      { envelope: true, threadId: true, bodyStructure: true, labels: true },
      { uid: true },
    )) {
      const parsed = parseMessage(msg)
      if (!parsed.threadId || !threadIds.has(parsed.threadId)) continue

      const from = parsed.from?.name || parsed.from?.address || '?'
      const date = parsed.date ? parsed.date.toISOString().slice(0, 10) : '?'

      // Archive all thread matches (even already-fetched ones)
      archiveUids.push(msg.uid)

      // Only download/return messages not already fetched from the label
      if (parsed.messageId && excludeMessageIds.has(parsed.messageId)) {
        dbg(`  SKIP (already in label) UID=${msg.uid} ${date} ${from} mid=${parsed.messageId}`)
        continue
      }
      dbg(`  MATCH UID=${msg.uid} ${date} ${from} mid=${parsed.messageId}`)
      toDownload.push({ parsed, uid: msg.uid, bodyStructure: msg.bodyStructure })
    }

    if (toDownload.length > 0) {
      onProgress?.(`  Found ${toDownload.length} reply message(s).`)
    }

    // Phase 2: Optionally download content for new messages only
    const results: FetchedEmailMessage[] = []

    for (const { parsed, uid, bodyStructure } of toDownload) {
      const downloadedAttachments: DownloadedFile[] = []

      if (download) {
        const textPartId = findTextPartId(bodyStructure)
        if (textPartId) {
          try {
            const buf = await downloadAttachment(client, uid, textPartId)
            if (buf) parsed.bodyText = buf.toString('utf-8')
          } catch {
            onProgress?.(`  Failed to download text part for UID ${uid}`)
          }
        }

        if (parsed.attachments && parsed.attachments.length > 0) {
          for (const att of parsed.attachments) {
            try {
              const data = await downloadAttachment(client, uid, att.partId)
              if (data && data.length > 0) {
                downloadedAttachments.push({ filename: att.filename, data })
                onProgress?.(`  Downloaded: ${att.filename} (${Math.round(data.length / 1024)}KB)`)
              }
            } catch (err) {
              onProgress?.(`  Attachment download failed (${att.filename}): ${(err as Error).message}`)
            }
          }
        }
      }

      results.push({ ...parsed, downloadedAttachments })
    }

    // Phase 3: Archive ALL thread matches from INBOX (not just new ones)
    if (archive && archiveUids.length > 0) {
      onProgress?.(`  Archiving ${archiveUids.length} message(s) from ${mailbox}...`)
      const uidSet = archiveUids.join(',')
      await client.messageFlagsRemove({ uid: uidSet }, ['\\Inbox'], { uid: true, useLabels: true })
    }

    return results
  } finally {
    lock.release()
  }
}

/**
 * Find the part ID of the text/plain (preferred) or text/html body in a MIME structure.
 * Returns the part ID string (e.g. "1", "1.1") or undefined if not found.
 */
// deno-lint-ignore no-explicit-any
function findTextPartId(structure: any): string | undefined {
  if (!structure) return undefined

  // Multipart: recurse into childNodes
  if (structure.childNodes && Array.isArray(structure.childNodes)) {
    // First pass: prefer text/plain
    for (const child of structure.childNodes) {
      const type = (child.type || '').toLowerCase()
      if (type === 'text/plain' && child.part) return child.part
    }
    // Second pass: accept text/html
    for (const child of structure.childNodes) {
      const type = (child.type || '').toLowerCase()
      if (type === 'text/html' && child.part) return child.part
    }
    // Recurse into nested multiparts
    for (const child of structure.childNodes) {
      const found = findTextPartId(child)
      if (found) return found
    }
    return undefined
  }

  // Single-part message
  const type = (structure.type || '').toLowerCase()
  if (type === 'text/plain' || type === 'text/html') {
    return structure.part || undefined
  }
  return undefined
}

// deno-lint-ignore no-explicit-any
function findHtmlPartId(structure: any): string | undefined {
  if (!structure) return undefined
  if (structure.childNodes && Array.isArray(structure.childNodes)) {
    for (const child of structure.childNodes) {
      const type = (child.type || '').toLowerCase()
      if (type === 'text/html' && child.part) return child.part
    }
    for (const child of structure.childNodes) {
      const found = findHtmlPartId(child)
      if (found) return found
    }
    return undefined
  }
  const type = (structure.type || '').toLowerCase()
  if (type === 'text/html') return structure.part || undefined
  return undefined
}

// deno-lint-ignore no-explicit-any
function extractAttachmentParts(structure: any, parts: EmailAttachmentMeta[] = []): EmailAttachmentMeta[] {
  if (!structure) return parts

  // Multipart: recurse into childNodes
  if (structure.childNodes && Array.isArray(structure.childNodes)) {
    for (const child of structure.childNodes) {
      extractAttachmentParts(child, parts)
    }
    return parts
  }

  // Leaf node: check for attachment disposition
  const disposition = structure.disposition?.toLowerCase()
  if (disposition === 'attachment' || disposition === 'inline') {
    const filename = structure.dispositionParameters?.filename || structure.parameters?.name
    if (filename && structure.part) {
      // Skip inline signature images (e.g. image001.png, image002.jpg)
      if (disposition === 'inline' && /^image\d+\.\w+$/i.test(filename)) {
        return parts
      }
      parts.push({
        partId: structure.part,
        filename,
        contentType: structure.type || 'application/octet-stream',
        size: structure.size || 0,
      })
    }
  }

  return parts
}

export function parseMessage(msg: FetchMessageObject): EmailMessage {
  const env: MessageEnvelopeObject = msg.envelope ?? {}

  const from = env.from?.[0]
  const to = env.to?.map((a) => ({ name: a.name, address: a.address }))
  const cc = env.cc?.map((a) => ({ name: a.name, address: a.address }))

  // Extract body text from raw source
  let bodyText = ''
  if (msg.source) {
    bodyText = msg.source.toString('utf-8')
  }

  // Extract attachment metadata from body structure
  const attachments = extractAttachmentParts(msg.bodyStructure)

  // Gmail labels via X-GM-LABELS extension
  // deno-lint-ignore no-explicit-any
  const rawLabels = (msg as any).labels as Set<string> | undefined
  const labels = rawLabels ? [...rawLabels] : undefined

  return {
    uid: msg.uid,
    threadId: msg.threadId,
    date: env.date,
    subject: env.subject,
    from: from ? { name: from.name, address: from.address } : undefined,
    to,
    cc,
    messageId: env.messageId,
    inReplyTo: env.inReplyTo,
    bodyText,
    ...(attachments.length > 0 ? { attachments } : {}),
    ...(labels ? { labels } : {}),
  }
}
