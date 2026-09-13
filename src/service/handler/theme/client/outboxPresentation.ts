import type { OutboxRecord } from '#lib/outbox/types.ts'

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
