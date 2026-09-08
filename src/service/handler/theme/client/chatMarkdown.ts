import { slackToMarkdown } from './slackMarkdown.ts'
import { parseDocument, parseLines } from './wysiwyg/parser.ts'
import { contextFor, renderExport } from './wysiwyg/render.ts'

// Older chat prompts required this subject/underline pair even in drafts shown for review.
const SLACK_SUBJECT = /^([ \t]*\*[^*\n]+\*)[ \t]*\n[ \t]*\*={3,}\*[ \t]*(?:\n|$)/

/** Render legacy Slack drafts as quoted prose without changing the conversation or a tool's payload. */
export function renderChatMarkdown(source: string): string {
  const doc = parseDocument(source)
  // Visit only the original blocks: code quoted inside a recovered draft stays code.
  const fences = [...doc.root.walk()].filter((node) => node.type === 'fence' && !node.indented)
  for (const node of fences) {
    const language = node.lang?.trim().toLowerCase() ?? ''
    const slack = language === 'slack' || language === 'mrkdwn'
    const legacy = ['', 'text', 'plaintext', 'md', 'markdown'].includes(language) && SLACK_SUBJECT.test(node.text)
    if (!slack && !legacy) continue

    const markdown = slackToMarkdown(node.text.replace(SLACK_SUBJECT, '$1\n'))
    const { nodes } = parseLines(doc, markdown.split('\n'))
    const quote = node.closest('blockquote') ? null : doc.createNode('blockquote')
    if (quote) node.addBefore(quote)
    for (const block of nodes) {
      if (quote) quote.appendChild(block)
      else node.addBefore(block)
    }
    doc.removeNode(node)
  }
  return renderExport(doc.blocks, { ...contextFor(doc), rawAsText: true })
}
