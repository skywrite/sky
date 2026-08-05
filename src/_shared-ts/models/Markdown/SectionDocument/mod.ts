import * as marked from 'marked'
import Document from '#shared/models/Markdown/Document/mod.ts'
import renderMarkdown from '#shared/models/Markdown/util/renderMarkdown.ts'
import splitYamlMarkdown from '#shared/models/Markdown/util/splitYamlMarkdown.ts'
import { parseWithError } from '#shared/yaml/mod.ts'

/** A line/character position within the markdown (after YAML is stripped). */
export interface Position {
  /** 0-based line number */
  line: number
  /** 0-based character offset within the line */
  char: number
}

/**
 * A section in the document hierarchy.
 * Represents a heading and all content until the next same-or-higher level heading.
 */
export interface Section {
  /** Heading level 1-6 (h1-h6) */
  level: number
  /** The heading text */
  heading: string
  /** Markdown content after heading, before any children or siblings */
  content: string
  /** Nested sections (headings with level > this.level) */
  children: Section[]
  /** Position of the heading (e.g., the `#` character) relative to markdown (after YAML) */
  start: Position
  /** Position where this section ends (exclusive — next heading or EOF) relative to markdown (after YAML) */
  end: Position
}

/** Warning about non-standard heading structure */
export interface SectionWarning {
  type: 'skipped-level' | 'late-h1'
  message: string
  heading: string
  level: number
}

/**
 * A Document that understands heading hierarchy.
 *
 * Parses markdown headings into a tree structure where each section contains
 * its heading, content, and any nested subsections.
 *
 * @example
 * ```typescript
 * const doc = SectionDocument.fromMarkdown(`---
 * title: My Doc
 * ---
 *
 * # Title
 * Intro text.
 *
 * ## Section A
 * Content A.
 *
 * ### Subsection A.1
 * Detail.
 *
 * ## Section B
 * Content B.
 * `)
 *
 * doc.sections[0].heading        // "Title"
 * doc.sections[0].children[0]    // Section A
 * doc.getSectionsAtLevel(2)      // [Section A, Section B]
 * ```
 */
export default class SectionDocument extends Document {
  private _sections: Section[] | null = null
  private _warnings: SectionWarning[] | null = null

  /**
   * Top-level sections in the document.
   * Lazily parsed on first access.
   */
  get sections(): Section[] {
    if (this._sections === null) {
      const result = parseSectionsFromTokens(this.markdownTokens)
      this._sections = result.sections
      this._warnings = result.warnings
    }
    return this._sections
  }

  /**
   * Warnings about non-standard heading structure.
   * Populated when sections are parsed.
   */
  get warnings(): SectionWarning[] {
    // Trigger parsing if not done yet
    if (this._warnings === null) {
      void this.sections // trigger lazy parsing
    }
    return this._warnings ?? []
  }

  /**
   * The root section if document starts with an H1, otherwise null.
   */
  get root(): Section | null {
    const first = this.sections[0]
    return first?.level === 1 ? first : null
  }

  /**
   * Find first section matching predicate (depth-first traversal).
   */
  findSection(predicate: (section: Section) => boolean): Section | undefined {
    return findSectionRecursive(this.sections, predicate)
  }

  /**
   * Get all sections at a specific heading level (flat list, depth-first order).
   */
  getSectionsAtLevel(level: number): Section[] {
    const result: Section[] = []
    collectSectionsAtLevel(this.sections, level, result)
    return result
  }

  /**
   * Get flat list of all sections (depth-first traversal).
   */
  getAllSections(): Section[] {
    const result: Section[] = []
    flattenSections(this.sections, result)
    return result
  }

  static override fromMarkdown(contentsWithOptionalYamlHeader: string): SectionDocument {
    const { yaml, markdown } = splitYamlMarkdown(contentsWithOptionalYamlHeader)
    const { data: yamlData, error: yamlError } = parseWithError(yaml)

    return new this(yamlData as Record<string, unknown>, markdown, yamlError)
  }
}

// --- Parsing helpers ---

interface ParseResult {
  sections: Section[]
  warnings: SectionWarning[]
}

interface ParseContext {
  warnings: SectionWarning[]
  seenLevels: Set<number>
  lastLevel: number | null
  posMap: Position[]
  endPosition: Position
}

function buildTokenPositionMap(tokens: marked.TokensList): { posMap: Position[]; endPosition: Position } {
  const posMap: Position[] = []
  let line = 0
  let char = 0
  for (const token of tokens) {
    posMap.push({ line, char })
    for (const c of token.raw) {
      if (c === '\n') {
        line++
        char = 0
      } else {
        char++
      }
    }
  }
  return { posMap, endPosition: { line, char } }
}

function parseSectionsFromTokens(tokens: marked.TokensList): ParseResult {
  const sections: Section[] = []
  const { posMap, endPosition } = buildTokenPositionMap(tokens)
  const context: ParseContext = {
    warnings: [],
    seenLevels: new Set(),
    lastLevel: null,
    posMap,
    endPosition,
  }
  let i = 0

  while (i < tokens.length) {
    const token = tokens[i]

    if (token.type === 'heading') {
      const headingToken = token as marked.Tokens.Heading
      checkForWarnings(headingToken, context)

      const { section, nextIndex } = parseSection(tokens, i, context)
      sections.push(section)
      i = nextIndex
    } else {
      // Content before any heading - skip for now
      // (could be captured as "preamble" if needed)
      i++
    }
  }

  return { sections, warnings: context.warnings }
}

function checkForWarnings(heading: marked.Tokens.Heading, context: ParseContext): void {
  const level = heading.depth

  // Check for late H1 (H1 appearing after other headings)
  if (level === 1 && context.seenLevels.size > 0) {
    context.warnings.push({
      type: 'late-h1',
      message: `H1 "${heading.text}" appears after other headings`,
      heading: heading.text,
      level,
    })
  }

  // Check for skipped levels (e.g., H2 → H4 without H3)
  if (context.lastLevel !== null && level > context.lastLevel + 1) {
    const skipped: string[] = []
    for (let l = context.lastLevel + 1; l < level; l++) {
      skipped.push(`H${l}`)
    }
    context.warnings.push({
      type: 'skipped-level',
      message: `H${level} "${heading.text}" skips ${skipped.join(', ')}`,
      heading: heading.text,
      level,
    })
  }

  context.seenLevels.add(level)
  context.lastLevel = level
}

function parseSection(
  tokens: marked.TokensList,
  startIndex: number,
  context: ParseContext,
): { section: Section; nextIndex: number } {
  const headingToken = tokens[startIndex] as marked.Tokens.Heading
  const level = headingToken.depth
  const heading = headingToken.text
  const start = context.posMap[startIndex]

  const contentTokens: marked.Token[] = []
  const children: Section[] = []

  let i = startIndex + 1

  while (i < tokens.length) {
    const token = tokens[i]

    if (token.type === 'heading') {
      const childHeading = token as marked.Tokens.Heading
      const childLevel = childHeading.depth

      if (childLevel <= level) {
        // Same or higher level = sibling or parent's sibling, stop
        break
      } else {
        // Deeper level = child section
        checkForWarnings(childHeading, context)
        const { section: child, nextIndex } = parseSection(tokens, i, context)
        children.push(child)
        i = nextIndex
      }
    } else {
      // Non-heading content belongs to this section
      contentTokens.push(token)
      i++
    }
  }

  const end = i < tokens.length ? context.posMap[i] : context.endPosition

  // Render content tokens to markdown string
  const content = renderMarkdown(contentTokens as marked.TokensList, { links: false }).trim()

  return {
    section: { level, heading, content, children, start, end },
    nextIndex: i,
  }
}

// --- Traversal helpers ---

function findSectionRecursive(sections: Section[], predicate: (section: Section) => boolean): Section | undefined {
  for (const section of sections) {
    if (predicate(section)) {
      return section
    }
    const found = findSectionRecursive(section.children, predicate)
    if (found) {
      return found
    }
  }
  return undefined
}

function collectSectionsAtLevel(sections: Section[], level: number, result: Section[]): void {
  for (const section of sections) {
    if (section.level === level) {
      result.push(section)
    }
    collectSectionsAtLevel(section.children, level, result)
  }
}

function flattenSections(sections: Section[], result: Section[]): void {
  for (const section of sections) {
    result.push(section)
    flattenSections(section.children, result)
  }
}
