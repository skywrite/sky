/**
 * Moving a saved transcript from the earlier shape, speaker headings at H2
 * under the title, into the current one (see shape.ts): `## Conversation`
 * before the first message, every speaker heading at H3.
 *
 * Only speaker heading lines change, and one heading is added. Frontmatter,
 * message text and the trailing context log keep every byte, so a transcript
 * reads back as the same conversation: reply-thread keys and the resume
 * history key, which hash the messages, still match. Headings normalize to
 * the one written form on the way: `AI Assistant` becomes Sky, a trailing
 * `(stamp)` moves to the front, and an unstamped name turns bold.
 *
 * The earlier reader treated every H2 under the title as a message, folding
 * the ones that named no speaker into the message before. So the section
 * opens at the first H2, and an H2 that is not a speaker heading stays as
 * written inside the message it belongs to.
 */

import {
  atxHeading,
  CONVERSATION_HEADING,
  isConversationHeading,
  legacySpeakerOf,
  markdownLines,
  speakerHeading,
} from './shape.ts'

export interface ChatShapeMigration {
  /** The transcript in the current shape; the input itself when nothing changed */
  markdown: string
  /** `current`: already in the shape. `migrated`: rewritten. */
  outcome: 'current' | 'migrated'
  /** Speaker headings rewritten */
  speakers: number
}

/** Where the body starts: after the closing `---` of a leading frontmatter block, or 0. */
function bodyStart(raw: string): number {
  const match = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(raw)
  return match ? match[0].length : 0
}

export function migrateChatMarkdown(raw: string, userLabel: string): ChatShapeMigration {
  const offset = bodyStart(raw)
  const lines = markdownLines(raw.slice(offset))
  const structural = lines.filter((line) => line.structural)
  if (structural.some((line) => isConversationHeading(line.text))) {
    return { markdown: raw, outcome: 'current', speakers: 0 }
  }

  const edits: Array<{ start: number; end: number; text: string }> = []
  let speakers = 0
  for (const line of structural) {
    const speaker = legacySpeakerOf(line.text, userLabel)
    if (!speaker) continue
    const ending = raw.slice(offset + line.start, offset + line.end).slice(line.text.length)
    edits.push({
      start: offset + line.start,
      end: offset + line.end,
      text: speakerHeading(speaker.role, speaker.when, userLabel) + ending,
    })
    speakers++
  }

  // The section opens at the first H2; with none, before a trailing context log or at the end.
  const firstH2 = structural.find((line) => atxHeading(line.text)?.level === 2)
  const log = structural.find((line) => /^<!-- (?:CONTEXT-LOG|TURN)\b/.test(line.text))
  const anchor = firstH2 ?? log
  const section = `## ${CONVERSATION_HEADING}\n`
  if (anchor) {
    const at = offset + anchor.start
    const previous = lines[lines.indexOf(anchor) - 1]
    const separator = previous && previous.text.trim() !== '' ? '\n' : ''
    edits.push({ start: at, end: at, text: `${separator}${section}\n` })
  } else {
    const body = raw.slice(offset)
    const separator = body === '' ? '\n' : body.endsWith('\n\n') ? '' : body.endsWith('\n') ? '\n' : '\n\n'
    edits.push({ start: raw.length, end: raw.length, text: `${separator}${section}` })
  }

  // Apply back to front so earlier offsets stay valid; an insertion sorts before a rewrite at the same place.
  edits.sort((a, b) => b.start - a.start || b.end - a.end)
  let markdown = raw
  for (const edit of edits) markdown = markdown.slice(0, edit.start) + edit.text + markdown.slice(edit.end)
  return { markdown, outcome: 'migrated', speakers }
}
