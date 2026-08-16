import { FILE_ABOUT_ME } from '#shared/config.ts'
import { readTextFileSync } from '#shared/fs/mod.ts'
import AboutMeDocument from '#shared/models/AboutMe/document/mod.ts'
import SectionDocument, { type Section } from '#shared/models/Markdown/SectionDocument/mod.ts'
import expand from '#shared/strings/expand.ts'
import type { ConversationMessage } from '../type.d.ts'
import { type ContextTurnLog, splitContextLog } from './ContextLog/mod.ts'

/**
 * A turn extracted from a chat document.
 */
export interface ChatTurn {
  /** Speaker name from H2 heading (e.g. "Jane" or "AI Assistant") */
  speaker: string
  /** Full content of the turn, including any child sections rendered as markdown */
  content: string
}

const SUMMARY_PATTERN = /<!--\s*SUMMARY:\s*(.+?)\s*-->/

const ASSISTANT_LABEL = 'AI Assistant'

let cachedUserLabel: string | undefined
let cachedPattern: RegExp | undefined

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
  cachedPattern = undefined
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const STAMP = String.raw`\d{4}-\d{2}-\d{2} \d{1,3}:\d{2}`

// A speaker heading in the notebook's message-file shape:
// `## 2026-02-08 14:32 - **Jane**` — leading stamp for scan symmetry, bold
// on the speaker (same convention slack/email captures use). The stamp is
// notebook time — extended hours (25:30 and beyond) keep multi-digit hour
// values, never clamped. Legacy transcripts stamped after a plain name
// (`## Jane (2026-02-08 14:32)`) or not at all (`## Jane`) — all three
// forms parse; writes emit only the message-file form. Anything else is
// not a speaker heading and folds back like any assistant-emitted H2.
function speakerPattern(): RegExp {
  if (!cachedPattern) {
    const names = `${escapeRegExp(userSpeakerLabel())}|${ASSISTANT_LABEL}`
    cachedPattern = new RegExp(`^(?:(${STAMP}) - \\*\\*(${names})\\*\\*|(${names})(?: \\((${STAMP})\\))?)$`)
  }
  return cachedPattern
}

function parseSpeaker(heading: string): { role: 'user' | 'assistant'; when?: string } | null {
  const match = heading.match(speakerPattern())
  if (!match) return null
  const name = match[2] ?? match[3]
  return { role: name === ASSISTANT_LABEL ? 'assistant' : 'user', when: match[1] ?? match[4] }
}

/**
 * ChatDocument - parses AI chat transcript files.
 *
 * Format:
 * ```
 * ---
 * created: 2026-02-08
 * summary: Topic Summary
 * provider: claude
 * model: claude-opus-4-6
 * turns: 4
 * ---
 *
 * # Topic Summary
 *
 * ## 2026-02-08 14:32 - **Jane**
 * User message.
 *
 * ## 2026-02-08 14:33 - **AI Assistant**
 * AI response.
 * ```
 *
 * The user's heading label comes from their profile (see userSpeakerLabel).
 * The stamp is optional — transcripts from before turn stamps have bare
 * `## Jane` / `## AI Assistant` headings, and early stamped ones carry a
 * trailing `(2026-02-08 14:32)` on a plain name instead.
 */
export default class ChatDocument extends SectionDocument {
  static override yamlKeyOrder = ['created', 'updated', 'summary', 'provider', 'model', 'turns', 'rel', 'tags']

  /** Summary from YAML frontmatter */
  get summary(): string {
    return (this.yaml['summary'] as string) ?? ''
  }

  /** AI provider from YAML (e.g. "claude", "openai") */
  get provider(): string {
    return (this.yaml['provider'] as string) ?? ''
  }

  /** Model name from YAML (e.g. "claude-opus-4-6") */
  get model(): string {
    return (this.yaml['model'] as string) ?? ''
  }

  /** Number of turns from YAML */
  get turnCount(): number {
    return (this.yaml['turns'] as number) ?? 0
  }

  /** Conversation turns extracted from H2 sections */
  get turns(): ChatTurn[] {
    if (!this.root) return []
    return this.root.children.filter((s) => s.level === 2).map(sectionToTurn)
  }

  /** Per-turn context pipeline log parsed from the trailing CONTEXT-LOG comment */
  get contextLog(): ContextTurnLog[] {
    return splitContextLog(this.markdown).entries
  }

  /**
   * The conversation as role-tagged messages, ready to seed a live session:
   * the trailing context log stripped, H2 headings the assistant emitted inside
   * a reply (split off as bogus speakers by the section parser) folded back
   * into the preceding message, and consecutive same-role messages merged so
   * the result alternates.
   */
  get conversation(): ConversationMessage[] {
    const { body } = splitContextLog(this.markdown)
    const turns = new ChatDocument(this.yaml, body).turns
    const messages: ConversationMessage[] = []

    for (const turn of turns) {
      const speaker = parseSpeaker(turn.speaker)
      const last = messages.at(-1)

      if (!speaker) {
        const heading = `## ${turn.speaker}`
        const restored = turn.content ? `${heading}\n\n${turn.content}` : heading
        if (last) {
          last.content += `\n\n${restored}`
        } else {
          messages.push({ role: 'user', content: restored })
        }
        continue
      }

      if (last && last.role === speaker.role) {
        // Merged turns keep the first stamp — the merge means one exchange.
        last.content += `\n\n${turn.content}`
      } else {
        const message: ConversationMessage = { role: speaker.role, content: turn.content }
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
    provider: string
    model: string
    rel?: string[]
    tags?: string[]
  }): ChatDocument {
    const turnCount = Math.floor(input.messages.length / 2)
    const yaml: Record<string, unknown> = {
      created: input.created,
      updated: input.updated,
      summary: input.summary,
      provider: input.provider,
      model: input.model,
      turns: turnCount,
      rel: input.rel && input.rel.length > 0 ? input.rel : null,
      tags: input.tags && input.tags.length > 0 ? input.tags.join('; ') : null,
    }
    const markdown = ChatDocument.buildMarkdown(input)
    return new ChatDocument(yaml, markdown)
  }

  private static buildMarkdown(input: { summary: string; messages: ConversationMessage[] }): string {
    const lines: string[] = [`# ${input.summary}`, '']

    for (let i = 0; i < input.messages.length; i++) {
      const msg = input.messages[i]
      if (msg.role === 'user') {
        const user = userSpeakerLabel()
        lines.push(msg.when ? `## ${msg.when} - **${user}**` : `## ${user}`)
        lines.push('')
        lines.push(msg.content)
        lines.push('')
      } else {
        lines.push(msg.when ? `## ${msg.when} - **${ASSISTANT_LABEL}**` : `## ${ASSISTANT_LABEL}`)
        lines.push('')
        lines.push(stripSummaryComment(msg.content))
        lines.push('')
        // Extra blank line after assistant response (before next question)
        if (i < input.messages.length - 1) {
          lines.push('')
        }
      }
    }

    return '\n' + lines.join('\n').trimEnd() + '\n'
  }
}

/**
 * Strip the <!-- SUMMARY: ... --> comment from assistant content.
 */
function stripSummaryComment(text: string): string {
  return text.replace(SUMMARY_PATTERN, '').trimEnd()
}

/**
 * The conversation's running summary: the latest <!-- SUMMARY: ... -->
 * comment the assistant emitted, else the given fallback, else the first
 * ten words of the first user message.
 *
 * The fallback matters for resumed chats: saved transcripts have SUMMARY
 * comments stripped, so if the new exchange doesn't emit one the original
 * frontmatter summary must win over the first-words guess.
 */
export function extractConversationSummary(messages: ConversationMessage[], fallback?: string): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') {
      const match = messages[i].content.match(SUMMARY_PATTERN)
      if (match) return match[1].trim()
    }
  }
  if (fallback) return fallback
  const first = messages.find((m) => m.role === 'user')?.content ?? ''
  return first.trim().split(/\s+/).slice(0, 10).join(' ')
}

/**
 * Convert a Section to a ChatTurn, including child sections rendered back to markdown.
 */
function sectionToTurn(section: Section): ChatTurn {
  const parts: string[] = []

  if (section.content) {
    parts.push(section.content)
  }

  if (section.children.length > 0) {
    if (section.content) parts.push('')
    parts.push(renderChildSections(section.children))
  }

  return {
    speaker: section.heading,
    content: parts.join('\n').trim(),
  }
}

/**
 * Render child sections back to markdown with proper heading levels.
 */
function renderChildSections(sections: Section[]): string {
  const lines: string[] = []

  for (const section of sections) {
    const prefix = expand('#', section.level)
    lines.push(`${prefix} ${section.heading}`)
    lines.push('')
    if (section.content) {
      lines.push(section.content)
      lines.push('')
    }
    if (section.children.length > 0) {
      lines.push(renderChildSections(section.children))
    }
  }

  return lines.join('\n').trimEnd()
}
