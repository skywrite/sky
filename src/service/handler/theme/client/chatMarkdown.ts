import { splitChatImages } from '#universal/ai/chatImages.ts'
import { slackToMarkdown } from './slackMarkdown.ts'
import { parseDocument, parseLines } from './wysiwyg/parser.ts'
import { contextFor, renderExport } from './wysiwyg/render.ts'

// Older chat prompts required this subject/underline pair even in drafts shown for review.
const SLACK_SUBJECT = /^([ \t]*\*[^*\n]+\*)[ \t]*\n[ \t]*\*={3,}\*[ \t]*(?:\n|$)/

export function legacySlackDraftMarkdown(text: string): string | null {
  return SLACK_SUBJECT.test(text) ? slackToMarkdown(text.replace(SLACK_SUBJECT, '$1\n')) : null
}

/** Render legacy Slack drafts as quoted prose without changing the conversation or a tool's payload. */
export function renderChatMarkdown(source: string): string {
  return renderChatBlocks(source).join('\n')
}

function renderChatBlocks(source: string): string[] {
  const doc = parseChatMarkdown(source)
  const context = { ...contextFor(doc), rawAsText: true }
  return doc.blocks.map((block) => renderExport([block], context))
}

const CARET = '<span class="sky-caret" aria-hidden="true"></span>'

/**
 * A reply still being written: one HTML string per block, the caret after the last word.
 * Block by block, so the page redraws only the block being written.
 */
export function renderStreamingChatMarkdown(source: string): string[] {
  const blocks = renderChatBlocks(settleStreamingMarkdown(source))
  const last = blocks.pop() ?? ''
  return [...blocks, last.replace(/(?:<\/[a-z][a-z0-9]*>\s*)*$/, (closing) => CARET + closing)]
}

/**
 * The line being written, as it will read once finished — the reader never watches raw marks
 * turn into formatting. Bold, italic and code opened on it close where the text stops; a link
 * shows its text until its address has arrived. Earlier lines, and code inside an open fence,
 * stand as written.
 */
export function settleStreamingMarkdown(source: string): string {
  const cut = source.lastIndexOf('\n') + 1
  const head = source.slice(0, cut)
  let line = source.slice(cut)
  if (inOpenFence(head) || /^[ \t>]*(?:`{3}|~{3})/.test(line)) return source
  // A lone "-" or "=" under a paragraph reads as a heading underline until the list or rule it begins arrives.
  if (/^[ \t]*[-=]+[ \t]*$/.test(line)) return head

  const closeWith = (mark: string) => line.replace(/[ \t]*$/, (space) => mark + space)
  const prose = () => line.replace(/`+[^`]*`+/g, '')

  line = line
    .replace(/(!?)\[([^\]]*)\]\([^)]*$/, (_link, image: string, text: string) => (image ? '' : text))
    .replace(/\[([^\][]*)$/, '$1')

  // A mark with nothing after it yet has opened nothing, and is left out.
  const ticks = line.match(/`+/g) ?? []
  const tick = ticks.at(-1)
  if (tick && ticks.length % 2 === 1) line = line.endsWith(tick) ? line.slice(0, -tick.length) : closeWith(tick)

  line = line.replace(/(?<![\w*])\*$/, '')
  if ((prose().match(/\*\*/g)?.length ?? 0) % 2 === 1) {
    if (line.endsWith('**')) line = line.slice(0, -2)
    // Half of the closing pair has arrived.
    else line = line.endsWith('*') ? `${line}*` : closeWith('**')
  }
  const opened = prose().match(/(?<![*\w\\])\*(?=[^\s*])/g)?.length ?? 0
  const closed = prose().match(/(?<=[^\s*])\*(?![*\w])/g)?.length ?? 0
  if (opened > closed) line = closeWith('*')
  return head + line
}

function inOpenFence(text: string): boolean {
  let open: string | null = null
  for (const line of text.split('\n')) {
    const [, mark, info] = line.match(/^[ \t>]*(`{3,}|~{3,})(.*)$/) ?? []
    if (!mark) continue
    if (open === null) open = mark
    // A shorter fence inside a longer one is part of its code.
    else if (mark.startsWith(open) && info!.trim() === '') open = null
  }
  return open !== null
}

/** Reading and editable-draft placement must see the same review quotes. */
export function parseChatMarkdown(source: string) {
  const doc = parseDocument(splitChatImages(source).text)
  // Visit only the original blocks: code quoted inside a recovered draft stays code.
  const fences = [...doc.root.walk()].filter((node) => node.type === 'fence' && !node.indented)
  for (const node of fences) {
    const language = node.lang?.trim().toLowerCase() ?? ''
    const slack = language === 'slack' || language === 'mrkdwn'
    const recovered = legacySlackDraftMarkdown(node.text)
    const legacy = ['', 'text', 'plaintext', 'md', 'markdown'].includes(language) && recovered !== null
    if (!slack && !legacy) continue

    const markdown = recovered ?? slackToMarkdown(node.text)
    const { nodes } = parseLines(doc, markdown.split('\n'))
    const quote = node.closest('blockquote') ? null : doc.createNode('blockquote')
    if (quote) node.addBefore(quote)
    for (const block of nodes) {
      if (quote) quote.appendChild(block)
      else node.addBefore(block)
    }
    doc.removeNode(node)
  }
  return doc
}
