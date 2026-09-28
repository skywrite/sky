import { miFrontmatter, toSingleLine } from '#shared/models/MostImportant/frontmatter.ts'
import { splitSentences } from '#shared/models/Person/format.ts'
import type { MIDraft } from './types.ts'

export function miMarkdown(draft: MIDraft, metadata: Record<string, unknown> = {}): string {
  const summary = toSingleLine(draft.summary)
  const dueBy = toSingleLine(draft.dueBy)
  return [
    miFrontmatter(summary, { ...metadata, summary }),
    '',
    `# ${summary}`,
    '',
    ...(dueBy ? [`Due: ${dueBy}`, ''] : []),
    draft.body.trim(),
    '',
  ].join('\n')
}

/** Sentences a drafted paragraph may hold, so the body reads at a glance instead of as a block. */
export const MAX_PARAGRAPH_SENTENCES = 2

/** A list item, heading, quote, table row, HTML, or indented code: never prose to break. */
const NOT_PROSE = /^(?: {4}|\t|\s*(?:[-*+]\s|\d+[.)]\s|#{1,6}\s|>|\||<))/
const FENCE = /^\s*(?:```|~~~)/gm

/**
 * Breaks each drafted prose paragraph longer than MAX_PARAGRAPH_SENTENCES at its sentence ends.
 * Only single-line paragraphs change; lists, headings, code, and hand-wrapped lines keep their shape.
 */
export function shortParagraphs(body: string): string {
  let fenced = false
  return body
    .split(/(\n[ \t]*\n)/)
    .map((block, index) => {
      if (index % 2 === 1) return block
      const fences = block.match(FENCE)?.length ?? 0
      const inCode = fenced || fences > 0
      if (fences % 2 === 1) fenced = !fenced
      if (inCode || block.includes('\n') || NOT_PROSE.test(block)) return block
      const sentences = wholeSpans(splitSentences(block.trim()))
      if (sentences.length <= MAX_PARAGRAPH_SENTENCES) return block
      const paragraphs: string[] = []
      for (let at = 0; at < sentences.length; at += MAX_PARAGRAPH_SENTENCES)
        paragraphs.push(sentences.slice(at, at + MAX_PARAGRAPH_SENTENCES).join(' '))
      return paragraphs.join('\n\n')
    })
    .join('')
}

/** Rejoins sentence pieces while one would leave a link, parenthesis, or code span open. */
function wholeSpans(pieces: string[]): string[] {
  const count = (text: string, char: string) => text.split(char).length - 1
  const open = (text: string) =>
    count(text, '`') % 2 === 1 || count(text, '[') > count(text, ']') || count(text, '(') > count(text, ')')
  const joined: string[] = []
  for (const piece of pieces) {
    const last = joined.length - 1
    if (last >= 0 && open(joined[last])) joined[last] = `${joined[last]} ${piece}`
    else joined.push(piece)
  }
  return joined
}
