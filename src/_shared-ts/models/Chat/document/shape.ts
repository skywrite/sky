/**
 * The shape of a saved chat transcript, shared by the reader, the writer and
 * the migration from the earlier shape:
 *
 * ```
 * # Title
 *
 * ## Summary (Opus 5.5, High)
 *
 * What the chat covered, written at save time by the model the heading names.
 *
 * ## Conversation
 *
 * ### 2026-02-08 14:32 - **Jane**
 *
 * The message as written.
 *
 * ### 2026-02-08 14:33 - **Sky**
 *
 * The reply as written, its own headings included.
 * ```
 *
 * `## Conversation` is the last section: everything after its heading is
 * conversation, and anything a save adds beside it, like the summary, goes
 * above it. A message
 * is an H3 speaker heading, a leading notebook-time stamp and a bold speaker,
 * the shape saved Slack conversations use; a message saved without a stamp
 * has the bold name alone, `### **Jane**`. The bold is what tells a speaker
 * from a reply's own `### Sky` section. Message text is kept exactly as written: reply-thread
 * keys and the resume history key hash it, so rewriting a reply's headings
 * would detach its threads and drop its tool history.
 */

import {
  fenceForLine,
  isClosingFence,
  type MarkdownFence,
  stripHtmlCommentsFromLine,
} from '#shared/models/Markdown/Document/_stripHtmlComments.ts'

export const CONVERSATION_HEADING = 'Conversation'

export const SUMMARY_HEADING = 'Summary'

/** The assistant's speaker label — Sky, the same name as the product. */
export const ASSISTANT_LABEL = 'Sky'

/** Labels the assistant wrote under before it was Sky; only the migration reads them, and writes Sky. */
export const LEGACY_ASSISTANT_LABELS = ['AI Assistant']

// Notebook time: extended hours (25:30 and beyond) keep multi-digit hours, never clamped.
const STAMP = String.raw`\d{4}-\d{2}-\d{2} \d{1,3}:\d{2}`

export interface SpeakerHeading {
  role: 'user' | 'assistant'
  /** The label as written: the owner's first name, or Sky */
  name: string
  /** The message's notebook-time stamp, when the heading carries one */
  when?: string
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const compiled = new Map<string, { current: RegExp; legacy: RegExp }>()

function patterns(userLabel: string): { current: RegExp; legacy: RegExp } {
  let found = compiled.get(userLabel)
  if (!found) {
    const current = [userLabel, ASSISTANT_LABEL].map(escapeRegExp).join('|')
    const legacy = [userLabel, ASSISTANT_LABEL, ...LEGACY_ASSISTANT_LABELS].map(escapeRegExp).join('|')
    found = {
      // `2026-02-08 14:32 - **Jane**`, or `**Jane**` for a message saved without a stamp
      current: new RegExp(`^(?:(${STAMP}) - \\*\\*(${current})\\*\\*|\\*\\*(${current})\\*\\*)$`),
      // The earlier H2 forms: stamp-led, bare, or a trailing `(stamp)` from before stamps led
      legacy: new RegExp(`^(?:(${STAMP}) - \\*\\*(${legacy})\\*\\*|(${legacy})(?: \\((${STAMP})\\))?)$`),
    }
    compiled.set(userLabel, found)
  }
  return found
}

function speaker(name: string, when: string | undefined): SpeakerHeading {
  const assistant = name === ASSISTANT_LABEL || LEGACY_ASSISTANT_LABELS.includes(name)
  return { role: assistant ? 'assistant' : 'user', name, ...(when ? { when } : {}) }
}

/**
 * An ATX heading's level and text, read the way CommonMark reads it: up to
 * three spaces of indent, a space after the hashes, a closing hash sequence
 * dropped. Null for anything else.
 */
export function atxHeading(line: string): { level: number; text: string } | null {
  const match = /^ {0,3}(#{1,6})(?=[ \t]|$)(.*)$/.exec(line.replace(/\r$/, ''))
  if (!match) return null
  const text = match[2]!
    .replace(/[ \t]+$/, '')
    .replace(/(?:^|[ \t]+)#+$/, '')
    .trim()
  return { level: match[1]!.length, text }
}

/** True for the `## Conversation` line. */
export function isConversationHeading(line: string): boolean {
  const heading = atxHeading(line)
  return heading?.level === 2 && heading.text === CONVERSATION_HEADING
}

/**
 * The summary heading: `## Summary (Opus 5.5, High)`. The parenthesis names
 * the model, and its effort, that wrote the section. Null when the line is
 * not one; `by` is null for a bare `## Summary`.
 */
export function summaryHeadingOf(line: string): { by: string | null } | null {
  const heading = atxHeading(line)
  if (heading?.level !== 2) return null
  const match = new RegExp(`^${SUMMARY_HEADING}(?: \\((.+)\\))?$`).exec(heading.text)
  return match ? { by: match[1] ?? null } : null
}

/** The line a summary section is written under. */
export function summaryHeading(by: string | null): string {
  return by ? `## ${SUMMARY_HEADING} (${by})` : `## ${SUMMARY_HEADING}`
}

/** The speaker an H3 message heading names, or null when the line is not one. */
export function speakerOf(line: string, userLabel: string): SpeakerHeading | null {
  const heading = atxHeading(line)
  if (heading?.level !== 3) return null
  const match = patterns(userLabel).current.exec(heading.text)
  if (!match) return null
  return speaker((match[2] ?? match[3])!, match[1])
}

/** The speaker an earlier-shape H2 message heading names, or null when the line is not one. */
export function legacySpeakerOf(line: string, userLabel: string): SpeakerHeading | null {
  const heading = atxHeading(line)
  if (heading?.level !== 2) return null
  const match = patterns(userLabel).legacy.exec(heading.text)
  if (!match) return null
  return speaker((match[2] ?? match[3])!, match[1] ?? match[4])
}

/** The heading a message is written under; the assistant always as Sky. */
export function speakerHeading(role: 'user' | 'assistant', when: string | undefined, userLabel: string): string {
  const name = role === 'assistant' ? ASSISTANT_LABEL : userLabel
  return when ? `### ${when} - **${name}**` : `### **${name}**`
}

export interface MarkdownLine {
  /** The line without its line ending */
  text: string
  /** Offset of the line's first character */
  start: number
  /** Offset after the line's ending */
  end: number
  /** The line begins outside a code fence and an HTML comment — the only place a heading can be one */
  structural: boolean
}

/**
 * Every line of the markdown, marked structural when it begins outside a code
 * fence and an HTML comment — by the same fence and comment rules the comment
 * stripper uses, so a heading quoted in a code block, or a saved chat's
 * context log, is never mistaken for structure.
 */
export function markdownLines(markdown: string): MarkdownLine[] {
  const lines: MarkdownLine[] = []
  let inComment = false
  let inFence: MarkdownFence | null = null
  let start = 0
  while (start < markdown.length) {
    const newline = markdown.indexOf('\n', start)
    const end = newline === -1 ? markdown.length : newline + 1
    const raw = markdown.slice(start, end)
    const text = raw.replace(/\r?\n$/, '')
    let structural = false
    if (inFence) {
      if (isClosingFence(text, inFence)) inFence = null
    } else if (inComment) {
      inComment = stripHtmlCommentsFromLine(raw, true).inComment
    } else {
      const fence = fenceForLine(text)
      if (fence) {
        inFence = fence
      } else {
        structural = true
        inComment = stripHtmlCommentsFromLine(raw, false).inComment
      }
    }
    lines.push({ text, start, end, structural })
    start = end
  }
  return lines
}
