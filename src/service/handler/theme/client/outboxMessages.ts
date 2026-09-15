import type { OutboxRecord } from '#lib/outbox/types.ts'
import { parseSlackConversation } from '#shared/models/Message/slack/parse.ts'
import { outboxSender } from './outboxPresentation.ts'
import { normalizeStamp, writtenAt } from './outboxTime.ts'

/**
 * The saved conversation as messages: who wrote, when, and what.
 * A Slack capture parses into its messages.
 * Anything else — an email, a capture that will not parse — is one message.
 */

type Source = OutboxRecord['conversation']['sources'][number]

export type OutboxMessage = {
  key: string
  /** The message's anchor in its saved file, when the capture names one. */
  id?: string
  author: string
  /** 'YYYY-MM-DD HH:MM', or empty when the capture carries no time. */
  at: string
  body: string
  /** False when the whole capture stands in for its messages. */
  parsed: boolean
}

export type SourceMessages = { source: Source; date: string; messages: OutboxMessage[] }

/** The messages in one saved capture. */
export function sourceMessages(source: Source, medium: OutboxRecord['conversation']['medium']): OutboxMessage[] {
  if (medium === 'Slack') {
    try {
      const parsed = parseSlackConversation(source.body).messages.map((message) => ({
        key: message.id ?? String(message.start),
        id: message.id,
        author: message.author,
        at: normalizeStamp(message.timestamp) || message.timestamp,
        body: message.body,
        parsed: true,
      }))
      if (parsed.length) return parsed
    } catch {
      // A damaged capture must remain readable while its scan reports the parsing failure.
    }
  }
  const times = [...(source.times ?? [])].map(normalizeStamp).filter(Boolean).sort()
  return [{ key: source.ref, author: outboxSender(source), at: times.at(-1) ?? '', body: source.body, parsed: false }]
}

/** The day a capture belongs to: the day folder in its ref, else its earliest message time. */
export function sourceDate(source: Source): string {
  const folder = source.ref.slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}$/.test(folder)) return folder
  const times = [...(source.times ?? [])].map(normalizeStamp).filter(Boolean).sort()
  return times[0]?.slice(0, 10) ?? ''
}

/** Every capture in date order, each with its messages. */
export function conversationMessages(item: OutboxRecord): SourceMessages[] {
  return item.conversation.sources
    .map((source, index) => ({
      source,
      index,
      date: sourceDate(source),
      messages: sourceMessages(source, item.conversation.medium),
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.index - b.index)
    .map(({ source, date, messages }) => ({ source, date, messages }))
}

/** Whether a message arrived after the reply was written. Only a stale item has new messages. */
export function isNewMessage(item: OutboxRecord, message: OutboxMessage): boolean {
  return item.stale && message.at !== '' && message.at > writtenAt(item)
}

/** How many saved messages arrived after the reply was written. */
export function newMessageCount(item: OutboxRecord): number {
  if (!item.stale) return 0
  return conversationMessages(item)
    .flatMap((entry) => entry.messages)
    .filter((message) => isNewMessage(item, message)).length
}
