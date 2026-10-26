import { NodeHtmlMarkdown } from 'node-html-markdown'
import { sanitizeEmailHtml } from '#commands/all/email/lib/sanitizeEmailHtml.ts'
import type { GmailMessage } from '#lib/google/gmail.ts'

const markdown = new NodeHtmlMarkdown({
  bulletMarker: '-',
  maxConsecutiveNewlines: 2,
  // The library's own rule also escapes "2026. " mid-sentence; only a line start can begin a list.
  lineStartEscape: [/^(\s*?)(?:((?:\+\s)|(?:[=>-])|(?:#{1,6}\s))|(\d+)(\.\s))/gm, '$1$3\\$2$4'],
})

/**
 * An email's own words as markdown. Newsletters lay out with tables, so cells become plain blocks;
 * link targets (tracking redirects) and images (sanitizing drops their sources) go, their text stays.
 */
export function emailMarkdown(message: Pick<GmailMessage, 'bodyHtml' | 'bodyText'>): string {
  if (!message.bodyHtml?.trim()) return message.bodyText?.trim() ?? ''
  const html = sanitizeEmailHtml(message.bodyHtml)
    .replace(/<(\/?)(?:table|thead|tbody|tfoot|tr|td|th)\b[^>]*>/gi, '<$1div>')
    .replace(/<\/?a\b[^>]*>/gi, '')
    .replace(/<img\b[^>]*>/gi, '')
  // A <br> converts to a hard break (two trailing spaces); the line stays, the spaces go.
  return markdown
    .translate(html)
    .replace(/[ \t]+$/gm, '')
    .trim()
}

/** Words only, so a quote taken from the email's plain text still finds its markdown paragraph. */
export function words(text: string): string {
  return text
    .replace(/\]\([^)]*\)/g, ']')
    .replace(/https?:\/\/\S+/g, ' ')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/**
 * The paragraphs from the one holding `start` through the one holding `end`, dropping a newsletter's
 * header and footer. Quotes match on words alone, ignoring case, punctuation and formatting.
 */
export function keepBetween(
  content: string,
  quotes: { start?: string; end?: string },
): { text: string } | { missing: 'start' | 'end' } {
  const blocks = content.split(/\n\s*\n/)
  const offsets: number[] = []
  let joined = ' '
  for (const block of blocks) {
    offsets.push(joined.length)
    joined += `${words(block)} `
  }
  const blockAt = (index: number) => offsets.findLastIndex((offset) => offset <= index)
  const find = (quote: string, from: number) => {
    const wanted = words(quote)
    return wanted ? { at: joined.indexOf(` ${wanted} `, from) + 1, length: wanted.length } : { at: 0, length: 0 }
  }

  let first = 0
  let last = blocks.length - 1
  if (quotes.start?.trim()) {
    const found = find(quotes.start, 0)
    if (found.at < 1) return { missing: 'start' }
    first = blockAt(found.at)
  }
  if (quotes.end?.trim()) {
    const found = find(quotes.end, offsets[first] - 1)
    if (found.at < 1) return { missing: 'end' }
    last = blockAt(found.at + found.length - 1)
  }
  return {
    text: blocks
      .slice(first, last + 1)
      .join('\n\n')
      .trim(),
  }
}
