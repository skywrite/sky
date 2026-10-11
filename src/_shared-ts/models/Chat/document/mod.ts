import { FILE_ABOUT_ME } from '#shared/config.ts'
import { readTextFileSync } from '#shared/fs/mod.ts'
import AboutMeDocument from '#shared/models/AboutMe/document/mod.ts'
import { type Attachment, attachmentsToYaml } from '#shared/models/Markdown/Document/attachment.ts'
import SectionDocument from '#shared/models/Markdown/SectionDocument/mod.ts'
import type { ConversationMessage } from '../type.d.ts'
import { type ContextTurnLog, splitContextLog } from './ContextLog/mod.ts'
import {
  atxHeading,
  CONVERSATION_HEADING,
  isConversationHeading,
  legacySpeakerOf,
  markdownLines,
  type SpeakerHeading,
  speakerHeading,
  speakerOf,
  summaryHeading,
  summaryHeadingOf,
} from './shape.ts'

/**
 * A message extracted from a chat document.
 */
export interface ChatTurn {
  /** The speaker heading's text (e.g. "2026-02-08 14:32 - **Jane**" or "Sky") */
  speaker: string
  /** The message as written, its own headings included */
  content: string
}

/**
 * The summary a save writes above the conversation. Not the title, which
 * is the frontmatter `summary:`.
 */
export interface ChatSummary {
  /** The model and effort that wrote it, as its heading names them ("Opus 5.5, High"); null when the heading names none */
  by: string | null
  text: string
}

/**
 * Where a branch came from: the parent chat, relative to the notebook root,
 * and the turn it left after. A branch file holds only its own turns; the
 * turns up to `turn` are the parent's, read from its file when the thread
 * is assembled. `turn` counts the whole lineage's turns, so a branch of a
 * branch names the turn in its parent's assembled thread.
 */
export interface ChatParent {
  chat: string
  turn: number
  /** A reply thread stays attached to one response. Absent for an independent fork. */
  kind?: 'thread'
  /** Stable reference to the source response, including its conversation prefix. */
  key?: string
}

let cachedUserLabel: string | undefined

/**
 * The user's speaker label: their first name from journal/about-me.md.
 * Transcript headings carry this label on every user turn, so the name
 * lives in the notebook, never in this code. Falls back to 'User' when no
 * profile exists. The label is expected to be stable — turns written under
 * a different label stop parsing as speaker headings and fold back into
 * the surrounding message.
 */
export function userSpeakerLabel(): string {
  if (cachedUserLabel === undefined) {
    try {
      cachedUserLabel = AboutMeDocument.fromMarkdown(readTextFileSync(FILE_ABOUT_ME)).firstName || 'User'
    } catch {
      cachedUserLabel = 'User'
    }
  }
  return cachedUserLabel
}

/** Test-only override — production code always derives the label from the profile. */
export function setUserSpeakerLabel(label: string): void {
  cachedUserLabel = label
}

interface ParsedTranscript {
  /** The `## Conversation` section was found */
  found: boolean
  /** Text between the section heading and its first message */
  leading: string
  messages: Array<{ heading: string; speaker: SpeakerHeading; content: string }>
}

/**
 * Read the conversation out of a transcript body: everything after the
 * `## Conversation` heading, split at H3 speaker headings outside code and
 * comments. Every other line belongs to the message it sits in, whatever
 * its heading level, exactly as written.
 */
function readTranscript(body: string, userLabel: string): ParsedTranscript {
  const lines = markdownLines(body)
  const at = lines.findIndex((line) => line.structural && isConversationHeading(line.text))
  if (at === -1) return { found: false, leading: '', messages: [] }

  const messages: ParsedTranscript['messages'] = []
  let leading = ''
  let open: { heading: string; speaker: SpeakerHeading } | null = null
  let from = lines[at]!.end
  const close = (to: number) => {
    const content = body.slice(from, to).trim()
    if (open) messages.push({ heading: open.heading, speaker: open.speaker, content })
    else leading = content
  }
  for (const line of lines.slice(at + 1)) {
    const speaker = line.structural ? speakerOf(line.text, userLabel) : null
    if (!speaker) continue
    close(line.start)
    open = { heading: line.text.replace(/^ {0,3}### /, '').trim(), speaker }
    from = line.end
  }
  close(body.length)
  return { found: true, leading, messages }
}

/**
 * ChatDocument - parses AI chat transcript files.
 *
 * Format (see shape.ts):
 * ```
 * ---
 * created: 2026-02-08
 * summary: Topic Summary
 * turns: 2
 * ---
 *
 * # Topic Summary
 *
 * ## Summary (Opus 5.5, High)
 *
 * What the chat covered.
 *
 * ## Conversation
 *
 * ### 2026-02-08 14:32 - **Jane**
 *
 * User message.
 *
 * ### 2026-02-08 14:33 - **Sky**
 *
 * AI response.
 * ```
 *
 * The user's heading label comes from their profile (see userSpeakerLabel);
 * the assistant's is Sky. A message saved without a stamp has the bold
 * name alone, `### **Jane**`. A file still in the earlier shape —
 * speaker headings at H2, no Conversation section — reads as no
 * conversation and reports `legacyShape`; `ai:chat:migrate` converts it.
 *
 * The header names no model: a chat may switch models between turns, and
 * each turn's context-log entry records the `settings` it ran under.
 * Transcripts written before 2026-09-17 carry `provider:` and `model:`
 * lines (the model set when the file was saved); they are read as any
 * other key and never written again.
 */
export default class ChatDocument extends SectionDocument {
  static override yamlKeyOrder = [
    'created',
    'updated',
    'summary',
    // Older transcripts only — kept in place when such a file is rewritten, never written anew.
    'provider',
    'model',
    'turns',
    'parent',
    'rel',
    'tags',
    'attachments',
    'approvals',
  ]

  /** Summary from YAML frontmatter */
  get summary(): string {
    return (this.yaml['summary'] as string) ?? ''
  }

  /** Number of turns from YAML */
  get turnCount(): number {
    return (this.yaml['turns'] as number) ?? 0
  }

  /** The chat this one branched from, or null for a chat that began on its own. */
  get parent(): ChatParent | null {
    const raw = this.yaml['parent']
    if (!raw || typeof raw !== 'object') return null
    const { chat, turn, kind, key } = raw as { chat?: unknown; turn?: unknown; kind?: unknown; key?: unknown }
    if (typeof chat !== 'string' || !chat || typeof turn !== 'number' || !Number.isInteger(turn) || turn < 0)
      return null
    return { chat, turn, ...(kind === 'thread' ? { kind, ...(typeof key === 'string' ? { key } : {}) } : {}) }
  }

  /** Approval keys (`tool:fileId`) the user blessed durably — created files and "always" answers. */
  get approvals(): string[] {
    const raw = this.yaml['approvals']
    return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : []
  }

  /**
   * The `## Summary` section above the conversation, or null when the file
   * has none. Its text runs to the next H1 or H2.
   */
  get summarySection(): ChatSummary | null {
    const { body } = splitContextLog(this.markdown)
    const lines = markdownLines(body)
    const end = lines.findIndex((line) => line.structural && isConversationHeading(line.text))
    if (end === -1) return null
    const above = lines.slice(0, end)
    const at = above.findIndex((line) => line.structural && summaryHeadingOf(line.text))
    if (at === -1) return null
    const next = above.slice(at + 1).find((line) => line.structural && (atxHeading(line.text)?.level ?? 3) <= 2)
    const text = body.slice(above[at]!.end, (next ?? lines[end]!).start).trim()
    return { by: summaryHeadingOf(above[at]!.text)!.by, text }
  }

  /** The messages under `## Conversation`, one per speaker heading, unmerged */
  get turns(): ChatTurn[] {
    const { body } = splitContextLog(this.markdown)
    return readTranscript(body, userSpeakerLabel()).messages.map((m) => ({ speaker: m.heading, content: m.content }))
  }

  /**
   * The file is still in the shape before `## Conversation`: speaker
   * headings at H2. Such a file reads as no conversation; a resume must
   * refuse it rather than save over it.
   */
  get legacyShape(): boolean {
    const { body } = splitContextLog(this.markdown)
    const lines = markdownLines(body).filter((line) => line.structural)
    if (lines.some((line) => isConversationHeading(line.text))) return false
    const userLabel = userSpeakerLabel()
    return lines.some((line) => legacySpeakerOf(line.text, userLabel) !== null)
  }

  /** Per-turn context pipeline log parsed from the trailing CONTEXT-LOG comment */
  get contextLog(): ContextTurnLog[] {
    return splitContextLog(this.markdown).entries
  }

  /**
   * The conversation as role-tagged messages, ready to seed a live session:
   * the trailing context log stripped, and consecutive same-role messages
   * merged so the result alternates. Text the section holds before its first
   * speaker heading, which only a hand edit puts there, opens as the user's.
   */
  get conversation(): ConversationMessage[] {
    const { body } = splitContextLog(this.markdown)
    const transcript = readTranscript(body, userSpeakerLabel())
    const messages: ConversationMessage[] = []
    if (transcript.leading) messages.push({ role: 'user', content: transcript.leading })

    for (const { speaker, content } of transcript.messages) {
      const last = messages.at(-1)
      if (last && last.role === speaker.role) {
        // Merged turns keep the first stamp — the merge means one exchange.
        last.content += `\n\n${content}`
      } else {
        const message: ConversationMessage = { role: speaker.role, content }
        if (speaker.when) message.when = speaker.when
        messages.push(message)
      }
    }
    return messages
  }

  static override fromMarkdown(contentsWithOptionalYamlHeader: string): ChatDocument {
    const doc = SectionDocument.fromMarkdown(contentsWithOptionalYamlHeader)
    return new ChatDocument(doc.yaml, doc.markdown, doc.yamlError)
  }

  /**
   * Create a new ChatDocument from structured input.
   */
  static create(input: {
    summary: string
    messages: ConversationMessage[]
    created: string
    updated: string
    rel?: string[]
    tags?: string[]
    /** Files in the day's attachments this chat read; the key is absent when there are none */
    attachments?: Attachment[]
    /** Durable approval keys; the key is absent when there are none */
    approvals?: string[]
    /** The chat this one branched from; the key is absent for a chat that began on its own */
    parent?: ChatParent | null
    /** Written above the conversation; the section is absent when there is none */
    summarySection?: ChatSummary | null
  }): ChatDocument {
    const turnCount = Math.floor(input.messages.length / 2)
    const yaml: Record<string, unknown> = {
      created: input.created,
      updated: input.updated,
      summary: input.summary,
      turns: turnCount,
      rel: input.rel && input.rel.length > 0 ? input.rel : null,
      tags: input.tags && input.tags.length > 0 ? input.tags.join('; ') : null,
    }
    if (input.parent) yaml.parent = { ...input.parent }
    if (input.attachments && input.attachments.length > 0) yaml.attachments = attachmentsToYaml(input.attachments)
    if (input.approvals && input.approvals.length > 0) yaml.approvals = [...input.approvals]
    const markdown = ChatDocument.buildMarkdown(input)
    return new ChatDocument(yaml, markdown)
  }

  private static buildMarkdown(input: {
    summary: string
    messages: ConversationMessage[]
    summarySection?: ChatSummary | null
  }): string {
    const lines: string[] = [`# ${input.summary}`, '']
    if (input.summarySection?.text) {
      lines.push(summaryHeading(input.summarySection.by), '', input.summarySection.text, '')
    }
    lines.push(`## ${CONVERSATION_HEADING}`, '')
    const userLabel = userSpeakerLabel()

    for (let i = 0; i < input.messages.length; i++) {
      const msg = input.messages[i]
      lines.push(speakerHeading(msg.role, msg.when, userLabel))
      lines.push('')
      lines.push(msg.content)
      lines.push('')
      // Extra blank line after assistant response (before next question)
      if (msg.role === 'assistant' && i < input.messages.length - 1) {
        lines.push('')
      }
    }

    return '\n' + lines.join('\n').trimEnd() + '\n'
  }
}

/** First ten words of the first user message — the last-resort title for a chat nothing else could name. */
export function firstWordsSummary(messages: ConversationMessage[]): string {
  const first = messages.find((m) => m.role === 'user')?.content ?? ''
  return first.trim().split(/\s+/).slice(0, 10).join(' ')
}
