import type { OutboxRecord } from '#lib/outbox/types.ts'

/**
 * How an item reads on a row and at the top of its page: its heading, its
 * summary, the one state token, who it is with and where.
 */

const countTitle = /^\d+\s+requests?\b/i

/** Older saved reviews still need a useful heading while their analysis is refreshed. */
export function outboxHeading(item: OutboxRecord): string {
  if (!countTitle.test(item.title.trim())) return item.title
  const source = item.conversation.sources.at(-1)
  const heading = source?.body.match(/^#\s+(.+)$/m)?.[1]
  if (heading && !/^(conversation|attachments)$/i.test(heading)) return heading
  const filename = source?.ref.split('/').at(-1)?.replace(/\.md$/i, '')
  const subject = filename?.split('_').at(-1)?.replace(/-/g, ' ')
  return subject && !/^[a-f\d]{24,}$/i.test(subject) ? subject : 'Review this conversation'
}

export function outboxPreview(text: string, limit = 240): string {
  const plain = text
    .replace(/\[([^\]]+)\]\([^\n)]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/^\s*[-*#]+\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (plain.length <= limit) return plain
  const end = plain.lastIndexOf(' ', limit)
  return `${plain.slice(0, end > limit / 2 ? end : limit).trimEnd()}…`
}

export function outboxCardSummary(item: OutboxRecord): string {
  if (item.summary) return item.summary
  // Keep legacy prose bounded until the next scan supplies its own semantic card summary.
  const context = item.situation.replace(/^\d+\s+requests?\s+(?:remain|need)[^.]*\.\s*/i, '')
  return outboxPreview(context, 280)
}

/** An item still in the person's hands: not yet placed in its app, or placed but changed since. */
export function outboxNeedsReview(item: OutboxRecord): boolean {
  return item.status !== 'ready' || item.stale
}

/** A finished item: sent, answered, or dismissed. */
export function outboxDone(item: OutboxRecord): boolean {
  return item.status === 'dismissed' || Boolean(item.delivery) || Boolean(item.responseHistory?.length)
}

/** The app the reply lives in. */
export function outboxApp(item: OutboxRecord): 'Slack' | 'Gmail' {
  return item.conversation.medium === 'Email' ? 'Gmail' : 'Slack'
}

/** The channel when the last saved message went to one; else the medium's plain name. */
export function outboxWhere(item: OutboxRecord): string {
  const to = item.conversation.sources.at(-1)?.to ?? ''
  if (to.startsWith('#')) return to
  return item.conversation.medium === 'Email' ? 'email' : 'direct message'
}

/** The name a saved message carries, or nothing: an older capture wrote a missing sender as the two characters `""`. */
export function outboxSender(source: { from: string } | undefined): string {
  const from = source?.from ?? ''
  return from === '""' ? '' : from
}

/** Who the reply is for: its recipient, else whoever wrote last; the place when no name was saved. */
export function outboxWho(item: OutboxRecord): string {
  if (item.recipient) return `To ${item.recipient}`
  return outboxSender(item.conversation.sources.at(-1)) || outboxWhere(item)
}

export type OutboxGlyph = 'channel' | 'direct' | 'email'

/** The row's glyph: # for a channel, @ for a direct message, an envelope for email. */
export function outboxGlyph(item: OutboxRecord): OutboxGlyph {
  if (item.conversation.medium === 'Email') return 'email'
  return outboxWhere(item).startsWith('#') ? 'channel' : 'direct'
}

/** The conversation in its app: the Slack thread, or the Gmail thread. */
export function outboxSourceLink(item: OutboxRecord): string | null {
  const target = item.conversation.target
  if (!target) return null
  return target.medium === 'Slack'
    ? target.link
    : `https://mail.google.com/mail/u/${encodeURIComponent(target.account)}/#all/${target.thread}`
}

export type OutboxTone = 'decide' | 'ready' | 'warn' | 'quiet' | 'done'
export type OutboxToken = { label: string; tone: OutboxTone }

/**
 * The one state token a row and an item page carry.
 * Finished items read Sent, Answered, or Dismissed.
 * Open ones read what the person does next.
 */
export function outboxToken(
  item: OutboxRecord,
  options: { awaiting?: boolean; unsavedDraft?: string } = {},
): OutboxToken {
  const history = item.responseHistory ?? []
  if (item.delivery || history.some((entry) => entry.kind === 'owner_report')) return { label: 'Sent', tone: 'done' }
  if (history.some((entry) => entry.kind === 'captured_reply')) return { label: 'Answered', tone: 'done' }
  if (item.status === 'dismissed') return { label: 'Dismissed', tone: 'done' }
  if (options.awaiting) return { label: 'Checking', tone: 'quiet' }
  if (item.stale) return { label: 'New messages', tone: 'warn' }
  if (item.status === 'placement_unknown') return { label: 'Could not place', tone: 'warn' }
  if (item.status === 'placing') return { label: 'Saving draft', tone: 'quiet' }
  if (item.status === 'ready') return { label: `Ready in ${outboxApp(item)}`, tone: 'ready' }
  return options.unsavedDraft?.trim() || item.draft.trim()
    ? { label: 'Draft ready', tone: 'ready' }
    : { label: 'Your decision', tone: 'decide' }
}
