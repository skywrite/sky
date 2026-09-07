import type { GmailMessage } from '#lib/google/gmail.ts'
import truncate from '#shared/strings/truncate.ts'
import { Instant } from '#universal/dates/nbdt/mod.ts'

export interface ReadMessage {
  from: string
  /** UTC message time, including milliseconds. */
  date?: string
  text: string
  truncated: boolean
}

export interface ReadThreadContent {
  messages: ReadMessage[]
  totalMessages: number
  omittedMessages: number
  /** True when any message was omitted or its body was shortened. */
  truncated: boolean
}

const MAX_MESSAGE_CHARS = 4000
const MAX_THREAD_CHARS = 24_000

/** Allocate the body budget newest-first, then return the retained messages oldest-first. */
export function readThreadContent(messages: GmailMessage[]): ReadThreadContent {
  let budget = MAX_THREAD_CHARS
  const rows: ReadMessage[] = []
  for (let i = messages.length - 1; i >= 0 && budget > 0; i--) {
    const message = messages[i]
    const body =
      message.bodyText?.trim() || (message.bodyHtml ? htmlToText(message.bodyHtml) : '') || '(no readable body)'
    const text = truncate(body, Math.min(MAX_MESSAGE_CHARS, budget))
    // A remaining single code unit cannot hold a leading surrogate pair.
    if (!text) break
    budget -= text.length
    const timestamp = message.date ? Instant.fromEpochMilliseconds(Number(message.date)) : undefined
    rows.push({
      from: message.from?.name || message.from?.address || '(unknown)',
      date: timestamp?.toString({ smallestUnit: 'millisecond' }),
      text,
      truncated: text.length < body.length,
    })
  }
  rows.reverse()
  const omittedMessages = messages.length - rows.length
  return {
    messages: rows,
    totalMessages: messages.length,
    omittedMessages,
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
