import { Lexer, Tokenizer, walkTokens } from 'marked'

/** Offsets are UTF-16 positions in the original Markdown body, excluding YAML. */
export interface SlackSection {
  level: number
  heading: string
  /** Includes an explicit anchor immediately before the heading, when present. */
  start: number
  headingStart: number
  bodyStart: number
  end: number
  id?: string
}

export interface SlackMessage extends SlackSection {
  timestamp: string
  author: string
  markdown: string
  body: string
  /** Explicit attachment fragments; unresolved attachment-* references are retained. */
  readonly attachmentIds: string[]
}

export interface SlackAttachment extends SlackSection {
  name: string
  markdown: string
  body: string
}

export interface SlackConversation {
  markdown: string
  format: 'legacy' | 'sectioned' | 'mixed'
  sections: SlackSection[]
  messages: SlackMessage[]
  attachments: SlackAttachment[]
}

const MESSAGE_HEADING = /^(\d{4}-\d{2}-\d{2}[ \t]+\d{1,2}:\d{2})[ \t]+[-–—][ \t]+(.+)$/
const ANCHOR = /^\s*<a\s+id=(?:"([^"\s]+)"|'([^'\s]+)')\s*>\s*<\/a>\s*$/i

export function isConversationSection(section: SlackSection): boolean {
  return section.level === 2 && /^Conversation$/i.test(section.heading)
}

export function isAttachmentsSection(section: SlackSection): boolean {
  return section.level === 2 && /^Attachments(?:\s+\(\d+\))?$/i.test(section.heading)
}

/**
 * Read Sky's saved Slack format. Only top-level Markdown headings can be
 * messages: legacy H2s, or H3s within Conversation. Quoted/list/code/HTML
 * examples are content. Source slices remain authoritative for later edits.
 */
export function parseSlackConversation(markdown: string): SlackConversation {
  const { text, originalOffset } = normalizeNewlines(markdown)
  const tokenizer = new Tokenizer()
  const lexer = new Lexer({
    gfm: true,
    tokenizer,
    extensions: {
      renderers: {},
      childTokens: {},
      block: [
        function (source) {
          // marked normally removes reference definitions from its token list.
          // Keep them as blocks so accumulated raw lengths remain exact offsets.
          const definition = tokenizer.def(source)
          if (definition) {
            this.lexer.tokens.links[definition.tag] ??= { href: definition.href, title: definition.title }
            return { ...definition, type: 'slack-definition' }
          }
          // Its paragraph/code merge inserts a newline into raw. Keep the original blocks for exact source ranges.
          return tokenizer.code(source)
        },
      ],
    },
  })
  // Block-only lexing avoids marked's costly inline pass during notebook scans.
  const tokens = lexer.blockTokens(text)
  const sections: SlackSection[] = []
  const open: SlackSection[] = []
  let offset = 0
  let anchor: { start: number; id: string } | undefined

  for (const token of tokens) {
    if (!text.startsWith(token.raw, offset)) throw new Error('Cannot locate Slack Markdown block in source.')
    if (token.type === 'heading') {
      const indentation = token.raw.match(/^( {0,3})#/)
      const headingStart = originalOffset(offset + (indentation?.[1].length ?? 0))
      const start = anchor?.start ?? originalOffset(offset)
      while (open.length && open.at(-1)!.level >= token.depth) open.pop()!.end = start
      const lineEnd = text.indexOf('\n', offset + token.raw.trimEnd().length)
      const section: SlackSection = {
        level: token.depth,
        heading: token.text,
        start,
        headingStart,
        bodyStart: originalOffset(lineEnd === -1 ? text.length : lineEnd + 1),
        end: markdown.length,
        ...(anchor ? { id: anchor.id } : {}),
      }
      sections.push(section)
      open.push(section)
    }
    if (token.type !== 'space') {
      const match = token.type === 'html' || token.type === 'paragraph' ? token.raw.match(ANCHOR) : null
      anchor = match ? { start: originalOffset(offset), id: match[1] ?? match[2] } : undefined
    }
    offset += token.raw.length
  }
  if (offset !== text.length) throw new Error('Slack Markdown parser did not consume the complete source.')

  const messages: SlackMessage[] = []
  const attachments: SlackAttachment[] = []
  let parent: SlackSection | undefined
  for (const section of sections) {
    if (section.level <= 2) parent = section.level === 2 ? section : undefined
    if (section.level === 3 && parent && isAttachmentsSection(parent)) {
      attachments.push({
        ...section,
        name: section.heading,
        markdown: markdown.slice(section.start, section.end),
        body: markdown.slice(section.bodyStart, section.end),
      })
    }
    if (section.level !== 2 && !(section.level === 3 && parent && isConversationSection(parent))) continue
    if (markdown[section.headingStart] !== '#') continue
    const match = section.heading.match(MESSAGE_HEADING)
    if (!match) continue
    const author = match[2].replace(/^\*\*(.*?)\*\*$/, '$1').trim()
    if (!author) continue
    const body = markdown.slice(section.bodyStart, section.end)
    let attachmentIds: string[] | undefined
    messages.push({
      ...section,
      timestamp: match[1].replace(/[ \t]+/g, ' '),
      author,
      markdown: markdown.slice(section.start, section.end),
      body,
      get attachmentIds() {
        return (attachmentIds ??= readAttachmentIds(body, lexer, attachments))
      },
    })
  }
  const hasSectioned = sections.some(isConversationSection)
  const hasLegacy = messages.some((message) => message.level === 2)
  return {
    markdown,
    format: hasSectioned ? (hasLegacy ? 'mixed' : 'sectioned') : 'legacy',
    sections,
    messages,
    attachments,
  }
}

function readAttachmentIds(body: string, sourceLexer: Lexer, attachments: SlackAttachment[]): string[] {
  const lexer = new Lexer()
  lexer.tokens.links = { ...sourceLexer.tokens.links }
  const known = new Set(attachments.map((attachment) => attachment.id))
  const ids = new Set<string>()
  walkTokens(lexer.lex(body), (token) => {
    if (token.type !== 'link' || !token.href.startsWith('#')) return
    let id = token.href.slice(1)
    try {
      id = decodeURIComponent(id)
    } catch {
      // Preserve an unresolved fragment even if a hand-written escape is invalid.
    }
    if (known.has(id) || id.startsWith('attachment-')) ids.add(id)
  })
  return [...ids]
}

export function normalizeNewlines(markdown: string): { text: string; originalOffset: (offset: number) => number } {
  if (!markdown.includes('\r')) return { text: markdown, originalOffset: (offset) => offset }
  const characters: string[] = []
  const offsets: number[] = []
  for (let index = 0; index < markdown.length; index++) {
    offsets.push(index)
    characters.push(markdown[index] === '\r' ? '\n' : markdown[index])
    if (markdown[index] === '\r' && markdown[index + 1] === '\n') index++
  }
  offsets.push(markdown.length)
  return { text: characters.join(''), originalOffset: (offset) => offsets[offset] }
}
