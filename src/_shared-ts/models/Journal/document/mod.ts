import SectionDocument, { type Section } from '#shared/models/Markdown/SectionDocument/mod.ts'
import expand from '#shared/strings/expand.ts'
import { dayWord } from '#universal/dates/mod.ts'
import type { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import { JournalTypes } from '../mod.ts'
import type { JournalType, Question } from '../type.d.ts'

/**
 * A question extracted from a journal document.
 */
export interface JournalQuestion {
  /** Heading text as-is (may include (AI) prefix) */
  question: string
  /** Content below heading */
  answer: string
  /** H3+ children */
  subQuestions: JournalQuestion[]
}

/**
 * Parsed components from the H1 heading.
 */
interface ParsedH1 {
  type: string
  date: string
  day: string
  time: string
}

// Matches: **Type: YYYY-MM-DD - Day - HH:MM**
const H1_REGEX = /^\*\*(.+?):\s+(\d{4}-\d{2}-\d{2})\s+-\s+(\w+)\s+-\s+(\d{2}:\d{2})\*\*$/

/**
 * JournalDocument - parses journal files in the new format.
 *
 * New format:
 * ```
 * # **Health: 2026-01-05 - Mon - 05:14**
 * ## How are you feeling?
 * Answer.
 * ### Sub-question?
 * Answer.
 * ```
 */
export default class JournalDocument extends SectionDocument {
  static override yamlKeyOrder = ['summary', 'rel', 'tags']
  private _parsed: ParsedH1 | null | undefined = undefined

  private get parsed(): ParsedH1 | null {
    if (this._parsed === undefined) {
      this._parsed = this.root ? parseH1(this.root.heading) : null
    }
    return this._parsed
  }

  /** Journal type from H1 prefix, e.g. 'Health' */
  get journalType(): JournalType | null {
    if (!this.parsed) return null
    return typeFromString(this.parsed.type)
  }

  /** Date string from H1, e.g. '2026-01-05' */
  get date(): string {
    return this.parsed?.date ?? ''
  }

  /** Time string from H1, e.g. '05:14' */
  get time(): string {
    return this.parsed?.time ?? ''
  }

  /** Questions extracted from H2 sections */
  get questions(): JournalQuestion[] {
    if (!this.root) return []
    return this.root.children.filter((s) => s.level === 2).map(parseQuestion)
  }

  static override fromMarkdown(contentsWithOptionalYamlHeader: string): JournalDocument {
    const doc = SectionDocument.fromMarkdown(contentsWithOptionalYamlHeader)
    return new JournalDocument(doc.yaml, doc.markdown, doc.yamlError)
  }

  /**
   * Create a new JournalDocument from scratch.
   */
  static create(input: { type: JournalType; date: PlainDateTime; questions: Question[] }): JournalDocument {
    const yaml = { rel: null, tags: `Journal/${typeSlugify(input.type)}` }
    const markdown = JournalDocument.buildMarkdown(input)
    return new JournalDocument(yaml, markdown)
  }

  private static buildMarkdown(input: { type: JournalType; date: PlainDateTime; questions: Question[] }): string {
    const dayWordShort = dayWord(input.date.toDayDateValue(), 'short')
    const lines: string[] = [`# **${input.type}: ${input.date.date} - ${dayWordShort} - ${input.date.time}**`, '']

    function renderQuestions(questions: Question[], depth: number): void {
      const header = expand('#', depth)
      for (const q of questions) {
        const [_pattern, _probability, question, subQuestions] = q
        lines.push(`${header} ${question}`)
        lines.push('')
        lines.push('')
        if (subQuestions) renderQuestions(subQuestions, depth + 1)
      }
    }

    renderQuestions(input.questions, 2)

    return '\n' + lines.join('\n').trimEnd() + '\n'
  }
}

function parseH1(heading: string): ParsedH1 | null {
  const match = heading.match(H1_REGEX)
  if (!match) return null
  return {
    type: match[1],
    date: match[2],
    day: match[3],
    time: match[4],
  }
}

function parseQuestion(section: Section): JournalQuestion {
  return {
    question: section.heading,
    answer: section.content,
    subQuestions: section.children.map(parseQuestion),
  }
}

function typeFromString(str: string): JournalType | null {
  const found = JournalTypes.find((t) => t === str)
  return found ?? null
}

function typeSlugify(type: string): string {
  return type.replaceAll(' ', '-')
}
