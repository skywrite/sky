import { Buffer } from 'node:buffer'
import type { GoogleClient } from './client.ts'
import { buildMimeMessage } from './mime.ts'
import type { MimeMessageInput } from './mime.ts'
import type { StoredTokens } from './tokens.ts'

// Gmail REST primitives for the google:email commands. The message shape
// mirrors the IMAP pipeline's EmailMessage closely so the notebook-side code
// ports without churn, but this module stays free of notebook concepts
// (follows, day files) the same way calendar.ts stays free of notebook time.
//
// Writes stop at labels and drafts: nothing here — or anywhere built on it —
// can send mail. Sending is a separate Gmail endpoint (drafts.send /
// messages.send) that is deliberately not implemented; the user sends from
// Gmail after reviewing the draft.

export const GMAIL_API_URL = 'https://gmail.googleapis.com/gmail/v1/users/me'

// gmail.modify is everything except permanent deletion — read, search,
// label/archive, and drafts — so one grant covers the whole google:email
// ladder without a second re-consent.
export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.modify'

/** Grants stored before the Gmail scope was added lack it; callers should say: re-run sky google:auth. */
export function hasGmailScope(tokens: StoredTokens): boolean {
  return tokens.scopes.includes(GMAIL_SCOPE)
}

/**
 * Gmail renders the same 64-bit thread id two ways: the REST API uses hex,
 * IMAP's X-GM-THRID uses decimal. Follow files store the decimal form (the
 * rendering the IMAP pipeline wrote first), so both pipelines match the same
 * follows. Convert at this boundary, never store the hex form in notebook
 * state.
 */
export function threadIdToDecimal(apiId: string): string {
  return BigInt(`0x${apiId}`).toString(10)
}

export function threadIdFromDecimal(decimalId: string): string {
  return BigInt(decimalId).toString(16)
}

export interface GmailAddress {
  name?: string
  address?: string
}

export interface GmailAttachment {
  filename: string
  contentType: string
  size: number
  /** Opaque id for getAttachment; only present in format=full responses. */
  attachmentId: string
}

export interface GmailMessage {
  /** Gmail API message id (hex). */
  id: string
  /** Gmail API thread id (hex) — use threadIdToDecimal before storing in follow refs. */
  threadId: string
  /** Gmail's arrival timestamp (internalDate) — steadier than the Date header. */
  date?: Date
  subject?: string
  from?: GmailAddress
  to?: GmailAddress[]
  cc?: GmailAddress[]
  /** RFC 822 Message-ID header. */
  messageId?: string
  inReplyTo?: string
  labelIds: string[]
  snippet?: string
  /** Decoded text/plain body; absent in format=metadata responses. */
  bodyText?: string
  /** Decoded text/html body; absent in format=metadata responses. */
  bodyHtml?: string
  attachments: GmailAttachment[]
}

export interface GmailLabel {
  id: string
  name: string
  type: 'system' | 'user'
}

export interface GmailThreadRef {
  id: string
  snippet?: string
  historyId?: string
}

interface LabelWire {
  id?: string
  name?: string
  type?: string
}

interface LabelsPageWire {
  labels?: LabelWire[]
}

interface ThreadRefWire {
  id?: string
  snippet?: string
  historyId?: string
}

interface ThreadsPageWire {
  threads?: ThreadRefWire[]
  nextPageToken?: string
}

interface HeaderWire {
  name?: string
  value?: string
}

interface BodyWire {
  attachmentId?: string
  size?: number
  data?: string
}

interface PartWire {
  mimeType?: string
  filename?: string
  headers?: HeaderWire[]
  body?: BodyWire
  parts?: PartWire[]
}

interface MessageWire {
  id?: string
  threadId?: string
  labelIds?: string[]
  snippet?: string
  internalDate?: string
  payload?: PartWire
}

interface ThreadWire {
  messages?: MessageWire[]
}

interface AttachmentWire {
  data?: string
}

export async function listLabels(client: GoogleClient): Promise<GmailLabel[]> {
  const wire = await client.getJson<LabelsPageWire>(`${GMAIL_API_URL}/labels`)
  return (wire.labels ?? []).flatMap((l) =>
    l.id && l.name
      ? [{ id: l.id, name: l.name, type: l.type === 'system' ? ('system' as const) : ('user' as const) }]
      : [],
  )
}

/** Resolve a label display name ("Sky/Follow") to its API id; exact match first, then case-insensitive. */
export async function resolveLabelId(client: GoogleClient, name: string): Promise<string | undefined> {
  const labels = await listLabels(client)
  const exact = labels.find((l) => l.name === name)
  if (exact) return exact.id
  const lower = name.toLowerCase()
  return labels.find((l) => l.name.toLowerCase() === lower)?.id
}

/**
 * Thread refs matching a Gmail query and/or label ids, newest-first (the
 * API's own order). Paginates until `limit` (default 100) refs are collected.
 */
export async function listThreads(
  client: GoogleClient,
  options: { q?: string; labelIds?: string[]; limit?: number } = {},
): Promise<GmailThreadRef[]> {
  const limit = options.limit ?? 100
  const threads: GmailThreadRef[] = []
  let pageToken: string | undefined
  do {
    const url = new URL(`${GMAIL_API_URL}/threads`)
    if (options.q) url.searchParams.set('q', options.q)
    for (const id of options.labelIds ?? []) url.searchParams.append('labelIds', id)
    url.searchParams.set('maxResults', String(Math.min(limit - threads.length, 500)))
    if (pageToken) url.searchParams.set('pageToken', pageToken)
    const page = await client.getJson<ThreadsPageWire>(url.toString())
    for (const wire of page.threads ?? []) {
      if (wire.id) threads.push({ id: wire.id, snippet: wire.snippet, historyId: wire.historyId })
    }
    pageToken = page.nextPageToken
  } while (pageToken && threads.length < limit)
  return threads.slice(0, limit)
}

/**
 * All messages in a thread, oldest-first (the API's own order), regardless of
 * which labels the individual messages carry — this is what replaces the IMAP
 * pipeline's separate INBOX scan for unlabeled replies. format=metadata
 * returns headers only; format=full adds decoded bodies and attachment refs.
 */
export async function getThread(
  client: GoogleClient,
  threadId: string,
  options: { format?: 'metadata' | 'full' } = {},
): Promise<GmailMessage[]> {
  const url = new URL(`${GMAIL_API_URL}/threads/${encodeURIComponent(threadId)}`)
  url.searchParams.set('format', options.format ?? 'metadata')
  const wire = await client.getJson<ThreadWire>(url.toString())
  return (wire.messages ?? []).flatMap((m) => {
    const message = normalizeMessage(m)
    return message ? [message] : []
  })
}

export async function getMessage(
  client: GoogleClient,
  messageId: string,
  options: { format?: 'metadata' | 'full' } = {},
): Promise<GmailMessage> {
  const url = new URL(`${GMAIL_API_URL}/messages/${encodeURIComponent(messageId)}`)
  url.searchParams.set('format', options.format ?? 'full')
  const wire = await client.getJson<MessageWire>(url.toString())
  const message = normalizeMessage(wire)
  if (!message) throw new Error(`Gmail message ${messageId} came back without id/threadId`)
  return message
}

export async function getAttachment(
  client: GoogleClient,
  messageId: string,
  attachmentId: string,
): Promise<Uint8Array> {
  const url = `${GMAIL_API_URL}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`
  const wire = await client.getJson<AttachmentWire>(url)
  return wire.data ? new Uint8Array(Buffer.from(wire.data, 'base64url')) : new Uint8Array(0)
}

/**
 * Add/remove labels across every message in a thread. Archiving is
 * removeLabelIds: ['INBOX']; system label ids ('INBOX', 'UNREAD', …) are
 * their own names and need no resolveLabelId.
 */
export async function modifyThread(
  client: GoogleClient,
  threadId: string,
  options: { addLabelIds?: string[]; removeLabelIds?: string[] },
): Promise<void> {
  await client.postJson<unknown>(`${GMAIL_API_URL}/threads/${encodeURIComponent(threadId)}/modify`, {
    addLabelIds: options.addLabelIds ?? [],
    removeLabelIds: options.removeLabelIds ?? [],
  })
}

export interface GmailDraft {
  /** Draft id (drafts.* endpoints). */
  id: string
  /** The draft's message id — what Gmail's web URLs address. */
  messageId: string
  threadId: string
}

interface DraftWire {
  id?: string
  message?: { id?: string; threadId?: string }
}

/**
 * File a new message under Drafts. drafts.create stores the message and
 * nothing more — it cannot send, and no send primitive exists in this
 * module (see the header comment). The draft is a fresh message, not a
 * reply: no thread, In-Reply-To, or References.
 */
export async function createDraft(client: GoogleClient, input: MimeMessageInput): Promise<GmailDraft> {
  const raw = Buffer.from(buildMimeMessage(input), 'utf-8').toString('base64url')
  const wire = await client.postJson<DraftWire>(`${GMAIL_API_URL}/drafts`, { message: { raw } })
  if (!wire.id || !wire.message?.id) throw new Error('Gmail draft came back without ids')
  return { id: wire.id, messageId: wire.message.id, threadId: wire.message.threadId ?? wire.message.id }
}

/**
 * Gmail web URL opening the draft in compose. authuser picks the account in
 * a multi-login browser (the /u/N index is per browser, not per account).
 */
export function draftUrl(email: string, messageId: string): string {
  return `https://mail.google.com/mail/?authuser=${encodeURIComponent(email)}#drafts?compose=${encodeURIComponent(messageId)}`
}

const ADDRESS_RE = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/

/**
 * Recipients as typed — `"Doe, Jane" <jane@example.com>, bob@example.com` —
 * to addresses; blank input is no recipients. Throws naming the first entry
 * that carries no usable email address.
 */
export function parseRecipients(text: string | undefined): GmailAddress[] {
  if (!text?.trim()) return []
  return splitAddressList(text).map((raw) => {
    const parsed = parseAddress(raw)
    if (!parsed?.address || !ADDRESS_RE.test(parsed.address)) {
      throw new Error(`Not an email address: ${raw.trim()}`)
    }
    return parsed
  })
}

function normalizeMessage(wire: MessageWire): GmailMessage | null {
  if (!wire.id || !wire.threadId) return null

  // First occurrence wins — headers can legally repeat.
  const headers = new Map<string, string>()
  for (const h of wire.payload?.headers ?? []) {
    const key = h.name?.toLowerCase()
    if (key && h.value && !headers.has(key)) headers.set(key, h.value)
  }

  const collected: BodyCollector = { attachments: [] }
  collectParts(wire.payload, collected)

  const subject = headers.get('subject')
  const to = parseAddressList(headers.get('to'))
  const cc = parseAddressList(headers.get('cc'))

  return {
    id: wire.id,
    threadId: wire.threadId,
    labelIds: wire.labelIds ?? [],
    snippet: wire.snippet,
    date: wire.internalDate ? new Date(Number(wire.internalDate)) : undefined,
    subject: subject ? decodeEncodedWords(subject) : undefined,
    from: parseAddressList(headers.get('from'))[0],
    to: to.length > 0 ? to : undefined,
    cc: cc.length > 0 ? cc : undefined,
    messageId: headers.get('message-id'),
    inReplyTo: headers.get('in-reply-to'),
    bodyText: collected.text,
    bodyHtml: collected.html,
    attachments: collected.attachments,
  }
}

type BodyCollector = {
  text?: string
  html?: string
  attachments: GmailAttachment[]
}

function collectParts(part: PartWire | undefined, out: BodyCollector): void {
  if (!part) return
  const mime = (part.mimeType ?? '').toLowerCase()
  const filename = (part.filename ?? '').trim()
  if (filename) {
    const attachmentId = part.body?.attachmentId
    if (attachmentId && !isInlineSignatureImage(part)) {
      out.attachments.push({
        filename,
        contentType: mime || 'application/octet-stream',
        size: part.body?.size ?? 0,
        attachmentId,
      })
    }
  } else if (mime === 'text/plain' && out.text === undefined && part.body?.data) {
    out.text = decodeBody(part.body.data)
  } else if (mime === 'text/html' && out.html === undefined && part.body?.data) {
    out.html = decodeBody(part.body.data)
  }
  for (const child of part.parts ?? []) collectParts(child, out)
}

/** Inline signature images (image001.png, …) are noise the IMAP pipeline also drops; keep both capture paths consistent. */
function isInlineSignatureImage(part: PartWire): boolean {
  if (!/^image\d+\.\w+$/i.test(part.filename ?? '')) return false
  const disposition = (part.headers ?? []).find((h) => h.name?.toLowerCase() === 'content-disposition')
  return (disposition?.value ?? '').toLowerCase().startsWith('inline')
}

/** Gmail body data is URL-safe base64. Decoded as UTF-8, matching the IMAP pipeline's tolerance for other charsets. */
function decodeBody(data: string): string {
  return Buffer.from(data, 'base64url').toString('utf-8')
}

/**
 * RFC 2047 encoded-words arrive raw in API header values (the IMAP envelope
 * decoded them for us); decode B and Q encodings for display parity.
 */
function decodeEncodedWords(value: string): string {
  if (!value.includes('=?')) return value
  // Whitespace between adjacent encoded words is transport padding, not content.
  const joined = value.replace(/(\?=)\s+(=\?)/g, '$1$2')
  return joined.replace(
    /=\?([^?]+)\?([bq])\?([^?]*)\?=/gi,
    (match, charset: string, encoding: string, text: string) => {
      try {
        const bytes =
          encoding.toLowerCase() === 'b'
            ? Buffer.from(text, 'base64')
            : Buffer.from(
                text
                  .replace(/_/g, ' ')
                  .replace(/=([0-9a-f]{2})/gi, (_hex, hex: string) => String.fromCharCode(parseInt(hex, 16))),
                'latin1',
              )
        return new TextDecoder(charset.toLowerCase()).decode(bytes)
      } catch {
        return match
      }
    },
  )
}

function parseAddressList(value: string | undefined): GmailAddress[] {
  if (!value) return []
  return splitAddressList(value).flatMap((raw) => {
    const address = parseAddress(raw)
    return address ? [address] : []
  })
}

/** Split on commas outside double quotes — display names may contain them ("Doe, Jane" <jane@example.com>). */
function splitAddressList(value: string): string[] {
  const parts: string[] = []
  let current = ''
  let inQuotes = false
  for (const ch of value) {
    if (ch === '"') inQuotes = !inQuotes
    if (ch === ',' && !inQuotes) {
      parts.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  parts.push(current)
  return parts.map((p) => p.trim()).filter(Boolean)
}

function parseAddress(raw: string): GmailAddress | undefined {
  const angled = raw.match(/^\s*(.*?)\s*<([^<>]+)>\s*$/)
  if (angled) {
    const name = decodeEncodedWords((angled[1] ?? '').replace(/^"|"$/g, '').trim())
    return { ...(name ? { name } : {}), address: (angled[2] ?? '').trim() }
  }
  const bare = raw.trim().replace(/^<|>$/g, '')
  if (!bare) return undefined
  return bare.includes('@') ? { address: bare } : { name: decodeEncodedWords(bare) }
}
