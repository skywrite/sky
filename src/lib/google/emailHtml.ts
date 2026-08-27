import { marked } from 'marked'

/**
 * Markdown → the HTML body of a Gmail draft. Standard markdown line
 * semantics: a blank line separates paragraphs and a lone newline is soft —
 * so hard-wrapped input still flows to the reader's width instead of
 * fossilizing 72-column line breaks the way a text/plain draft does. Bare
 * URLs, lists, links and emphasis render; everything else stays literal.
 */
export function renderEmailHtml(markdown: string): string {
  return marked.parse(markdown.trim(), { async: false, gfm: true, breaks: false }).trim()
}
