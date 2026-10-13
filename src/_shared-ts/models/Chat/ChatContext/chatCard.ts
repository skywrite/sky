/**
 * A saved chat as the chat context carries it: its card, the file above
 * `## Conversation` — frontmatter, title and the `## Summary` a save writes —
 * and a line counting the messages left out. A past chat is past output, and
 * its conversation is nearly all of its tokens: whole, every chat a query
 * touched filled the budget with old turns. The card tells a model what the
 * chat holds; read_chat opens the conversation when what was said matters.
 *
 * Admission scores the card, not the transcript, so a chat comes in on a word
 * match only when its title, tags, links or summary carry the word. A chat
 * the person pins in by hand comes in whole (`wholeChat`).
 */

import { Document } from '#shared/models/Markdown/mod.ts'
import { isAIChatPath } from '#shared/nbfs/mod.ts'
import { userSpeakerLabel } from '../document/mod.ts'
import { isConversationHeading, markdownLines, speakerOf } from '../document/shape.ts'

/** The chat tool that opens a saved chat's conversation, named on every card. */
export const READ_CHAT_TOOL = 'read_chat'

/**
 * The card for a saved chat's markdown: everything above `## Conversation`,
 * then a line counting the messages it leaves out. A file without a
 * conversation section is its own card.
 */
export function chatCard(markdown: string): string {
  const lines = markdownLines(markdown)
  const at = lines.findIndex((line) => line.structural && isConversationHeading(line.text))
  if (at === -1) return markdown
  const userLabel = userSpeakerLabel()
  const messages = lines.slice(at + 1).filter((line) => line.structural && speakerOf(line.text, userLabel)).length
  const counted = `${messages} ${messages === 1 ? 'message' : 'messages'}`
  const above = markdown.slice(0, lines[at]!.start).trimEnd()
  return `${above}\n\n_The conversation (${counted}) is not shown here; ${READ_CHAT_TOOL} opens it._\n`
}

/**
 * A notebook file as the chat context reads it, HTML comments stripped. A
 * saved chat is its card unless `wholeChat` asks for all of it; whole, it
 * keeps every section, since its replies' own headings are message text:
 * under `## Conversation` a reply's "## Transcript notes" would otherwise
 * drop every later message. Any other file loses its transcript sections.
 */
export function contextDocument(filePath: string, markdown: string, opts: { wholeChat?: boolean } = {}): Document {
  if (isAIChatPath(filePath)) {
    return Document.fromMarkdown(opts.wholeChat ? markdown : chatCard(markdown)).stripHtmlComments()
  }
  return Document.fromMarkdown(markdown)
    .stripHtmlComments()
    .filterSections((h) => !h.text.toLowerCase().includes('transcript'))
}
