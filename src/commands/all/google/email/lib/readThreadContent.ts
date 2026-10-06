import type { GmailMessage } from '#lib/google/gmail.ts'
import truncate from '#shared/strings/truncate.ts'
import { Instant } from '#universal/dates/nbdt/mod.ts'

export interface ReadMessage {
  id: string
  from: string
  /** UTC message time, including milliseconds. */
  date?: string
  text: string
  truncated: boolean
  offset: number
  characters: number
  nextOffset?: number
}

export interface ReadThreadContent {
  /** Complete attachment inventory for the requested thread or selected message, independent of body limits. */
  attachments: ReadAttachment[]
  messages: ReadMessage[]
  totalMessages: number
  omittedMessages: number
  omittedMessageIds: string[]
  /** True when any message was omitted or its body was shortened. */
  truncated: boolean
}

export interface ReadAttachment {
  messageId: string
  partId: string
  filename: string
  contentType: string
  size: number
  inline: boolean
}

export function attachmentInventory(messages: GmailMessage[]): ReadAttachment[] {
  return messages.flatMap((message) =>
    message.attachments.map((attachment) => ({
      messageId: message.id,
      partId: attachment.partId ?? attachment.attachmentId ?? '',
      filename: attachment.filename,
      contentType: attachment.contentType,
      size: attachment.size,
      inline: attachment.inline === true,
    })),
  )
}

const MAX_MESSAGE_CHARS = 4000
const MAX_THREAD_CHARS = 24_000

/** Allocate the body budget newest-first, then return the retained messages oldest-first. */
export function readThreadContent(
  messages: GmailMessage[],
  options: { message?: string; offset?: number } = {},
): ReadThreadContent {
  let budget = MAX_THREAD_CHARS
  const rows: ReadMessage[] = []
  const selected = options.message ? messages.find((message) => message.id === options.message) : undefined
  if (options.message && !selected)
    throw new Error('That message is not in this Gmail thread. Use an id from this thread’s read result.')
  if (options.offset && !selected) throw new Error('A message id is required when continuing at an offset.')
  for (let i = messages.length - 1; i >= 0 && budget > 0; i--) {
    const message = messages[i]
    if (selected && message !== selected) continue
    const body =
      message.bodyText?.trim() || (message.bodyHtml ? htmlToText(message.bodyHtml) : '') || '(no readable body)'
    const offset = selected ? (options.offset ?? 0) : 0
    if (!Number.isInteger(offset) || offset < 0 || offset >= body.length)
      throw new Error('The offset is outside this message. Use the nextOffset returned by the previous read.')
    if (offset > 0 && /[\uDC00-\uDFFF]/.test(body[offset]!) && /[\uD800-\uDBFF]/.test(body[offset - 1]!))
      throw new Error('The offset splits a character. Use the nextOffset returned by the previous read.')
    const text = truncate(body.slice(offset), Math.min(selected ? MAX_THREAD_CHARS : MAX_MESSAGE_CHARS, budget))
    // A remaining single code unit cannot hold a leading surrogate pair.
    if (!text) break
    budget -= text.length
    const timestamp = message.date ? Instant.fromEpochMilliseconds(Number(message.date)) : undefined
    rows.push({
      id: message.id,
      from: message.from?.name || message.from?.address || '(unknown)',
      date: timestamp?.toString({ smallestUnit: 'millisecond' }),
      text,
      truncated: offset + text.length < body.length,
      offset,
      characters: body.length,
      ...(offset + text.length < body.length ? { nextOffset: offset + text.length } : {}),
    })
  }
  rows.reverse()
  const omittedMessages = messages.length - rows.length
  const kept = new Set(rows.map((row) => row.id))
  return {
    attachments: attachmentInventory(selected ? [selected] : messages),
    messages: rows,
    totalMessages: messages.length,
    omittedMessages,
    omittedMessageIds: messages.filter((message) => !kept.has(message.id)).map((message) => message.id),
    truncated: omittedMessages > 0 || rows.some((row) => row.truncated),
  }
}

/** Just enough HTML stripping for a body that has no text/plain part. */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}
