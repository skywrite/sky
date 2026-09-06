import { FILE_ABOUT_ME } from '#shared/config.ts'
import { readTextFileSync } from '#shared/fs/mod.ts'
import AboutMeDocument from '#shared/models/AboutMe/document/mod.ts'
import { type Attachment, attachmentsToYaml } from '#shared/models/Markdown/Document/attachment.ts'
import SectionDocument, { type Section } from '#shared/models/Markdown/SectionDocument/mod.ts'
import expand from '#shared/strings/expand.ts'
import type { ConversationMessage } from '../type.d.ts'
import { type ContextTurnLog, splitContextLog } from './ContextLog/mod.ts'

/**
 * A turn extracted from a chat document.
 */
export interface ChatTurn {
  /** Speaker name from H2 heading (e.g. "Jane" or "Sky") */
  speaker: string
  /** Full content of the turn, including any child sections rendered as markdown */
  content: string
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
}

/**
 * The assistant's speaker label — Sky, the same name as the product. Every
 * assistant heading written today carries it.
 */
const ASSISTANT_LABEL = 'Sky'

/**
 * Labels the assistant wrote under before it was Sky. Transcripts already
 * in the notebook keep them, so they still parse as assistant turns — but
 * they are never written again: a resumed transcript is rebuilt from its
 * conversation on save, and its old headings come back as Sky.
 */
const LEGACY_ASSISTANT_LABELS = ['AI Assistant']

const ASSISTANT_LABELS = new Set([ASSISTANT_LABEL, ...LEGACY_ASSISTANT_LABELS])

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
    const names = [userSpeakerLabel(), ...ASSISTANT_LABELS].map(escapeRegExp).join('|')
    cachedPattern = new RegExp(`^(?:(${STAMP}) - \\*\\*(${names})\\*\\*|(${names})(?: \\((${STAMP})\\))?)$`)
  }
  return cachedPattern
}

function parseSpeaker(heading: string): { role: 'user' | 'assistant'; when?: string } | null {
  const match = heading.match(speakerPattern())
  if (!match) return null
  const name = match[2] ?? match[3]
  return { role: ASSISTANT_LABELS.has(name) ? 'assistant' : 'user', when: match[1] ?? match[4] }
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
 * ## 2026-02-08 14:33 - **Sky**
 * AI response.
 * ```
 *
 * The user's heading label comes from their profile (see userSpeakerLabel);
 * the assistant's is Sky, with `AI Assistant` still read from older
 * transcripts (see LEGACY_ASSISTANT_LABELS). The stamp is optional —
 * transcripts from before turn stamps have bare `## Jane` / `## Sky`
 * headings, and early stamped ones carry a trailing `(2026-02-08 14:32)`
 * on a plain name instead.
 */
export default class ChatDocument extends SectionDocument {
  static override yamlKeyOrder = [
    'created',
    'updated',
    'summary',
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

  /** The chat this one branched from, or null for a chat that began on its own. */
  get parent(): ChatParent | null {
    const raw = this.yaml['parent']
    if (!raw || typeof raw !== 'object') return null
    const { chat, turn } = raw as { chat?: unknown; turn?: unknown }
    if (typeof chat !== 'string' || !chat || typeof turn !== 'number' || !Number.isInteger(turn) || turn < 0)
      return null
    return { chat, turn }
  }

  /** Approval keys (`tool:fileId`) the user blessed durably — created files and "always" answers. */
  get approvals(): string[] {
    const raw = this.yaml['approvals']
    return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : []
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
    /** Files in the day's attachments this chat read; the key is absent when there are none */
    attachments?: Attachment[]
    /** Durable approval keys; the key is absent when there are none */
    approvals?: string[]
    /** The chat this one branched from; the key is absent for a chat that began on its own */
    parent?: ChatParent | null
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
    if (input.parent) yaml.parent = { chat: input.parent.chat, turn: input.parent.turn }
    if (input.attachments && input.attachments.length > 0) yaml.attachments = attachmentsToYaml(input.attachments)
    if (input.approvals && input.approvals.length > 0) yaml.approvals = [...input.approvals]
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
        lines.push(msg.content)
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

/** First ten words of the first user message — the last-resort title for a chat nothing else could name. */
export function firstWordsSummary(messages: ConversationMessage[]): string {
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
