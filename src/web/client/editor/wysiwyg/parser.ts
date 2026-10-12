/**
 * Markdown → model: a line-by-line block parser (architecture §4.1). Every block records the marker,
 * indentation and blank lines it was written with, so the serializer gives the file back byte for
 * byte (RT-3). Containers strip their prefix from each line, remember it, and run a fresh parse over
 * the inner lines. The same parser re-parses a single block while editing (§4.2).
 */

import { type Alignment, MarkdownDocument, type Node } from './model.ts'

export interface ParseOptions {
  /** Recognize four-space indented code — only when a file is opened, never while editing (RT-12). */
  indentedCode: boolean
}

export interface ParseResult {
  nodes: Node[]
  /** Blank lines after the last block. */
  tail: number
  tailLines?: string[]
}

const OPEN_DEFAULTS: ParseOptions = { indentedCode: true }

export function parseDocument(source: string, options: Partial<ParseOptions> = {}): MarkdownDocument {
  const doc = new MarkdownDocument()
  doc.lineEnding = source.includes('\r\n') ? '\r\n' : '\n'
  const lines = (doc.lineEnding === '\r\n' ? source.replaceAll('\r\n', '\n') : source).split('\n')
  doc.finalNewline = source.length === 0 || (lines.length > 1 && lines[lines.length - 1] === '')
  if (doc.finalNewline) lines.pop()

  const opts = { ...OPEN_DEFAULTS, ...options }
  const frontmatter = parseFrontmatter(doc, lines)
  if (frontmatter) doc.root.appendChild(frontmatter.node)

  const result = parseLines(doc, lines.slice(frontmatter?.lineCount ?? 0), opts)
  for (const node of result.nodes) doc.root.appendChild(node)
  applyTail(doc.root, result)
  return doc
}

/** Re-parses `source` into an existing document: the old blocks go, the new ones get fresh ids. */
export function parseInto(doc: MarkdownDocument, source: string, options: Partial<ParseOptions> = {}) {
  for (const block of doc.blocks) doc.removeNode(block)
  doc.root.tail = undefined
  doc.root.tailLines = undefined
  doc.lineEnding = source.includes('\r\n') ? '\r\n' : '\n'
  const lines = (doc.lineEnding === '\r\n' ? source.replaceAll('\r\n', '\n') : source).split('\n')
  doc.finalNewline = source.length === 0 || (lines.length > 1 && lines[lines.length - 1] === '')
  if (doc.finalNewline) lines.pop()
  const opts = { ...OPEN_DEFAULTS, ...options }
  const frontmatter = parseFrontmatter(doc, lines)
  if (frontmatter) doc.root.appendChild(frontmatter.node)
  const result = parseLines(doc, lines.slice(frontmatter?.lineCount ?? 0), opts)
  for (const node of result.nodes) doc.root.appendChild(node)
  applyTail(doc.root, result)
}

/** Parses lines into detached blocks, creating nodes in `doc`. */
export function parseLines(doc: MarkdownDocument, lines: string[], options: Partial<ParseOptions> = {}): ParseResult {
  return new BlockParser(doc, lines, { ...OPEN_DEFAULTS, ...options }).parse()
}

/**
 * Parses a leaf's text as blocks again — the "does this block still want to be a paragraph?"
 * primitive (§4.2). Returns null when the text is still one block of the same type; otherwise the
 * detached blocks that should replace it. Indented code is never recognized here (TYP-30).
 */
export function reparseBlock(doc: MarkdownDocument, node: Node, options: Partial<ParseOptions> = {}): Node[] | null {
  if (node.text.length === 0) return null
  const result = parseLines(doc, node.text.split('\n'), { indentedCode: false, ...options })
  const only = result.nodes.length === 1 ? result.nodes[0]! : null
  if (only && only.type === node.type && only.text === node.text && result.tail === 0) {
    doc.removeNode(only)
    return null
  }
  if (result.nodes.length === 0) {
    return [doc.createNode('paragraph', { text: node.text })]
  }
  // A fence the text opened closes with the text: saved without a closer, it would swallow the file.
  for (const block of result.nodes) if (block.type === 'fence') block.noCloseTag = undefined
  const first = result.nodes[0]!
  first.ahead = node.ahead
  first.aheadLines = node.aheadLines
  return result.nodes
}

export function applyTail(container: Node, result: ParseResult) {
  if (result.tail > 0) {
    container.tail = result.tail
    if (result.tailLines) container.tailLines = result.tailLines
  }
}

// --- line shapes -------------------------------------------------------------------------------

const BLANK_RE = /^[ \t]*$/
const ATX_RE = /^( {0,3})(#{1,6})(?=[ \t]|$)(.*)$/
const SETEXT_RE = /^ {0,3}(=+|-+)[ \t]*$/
const HR_RE = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/
const FENCE_RE = /^( {0,3})(`{3,}|~{3,})([ \t]*)(.*?)([ \t]*)$/
const QUOTE_RE = /^( {0,3})>( ?)/
const LIST_RE = /^( {0,3})(?:([-+*])|(\d{1,9})([.)]))( +|$)/
const TASK_RE = /^\[([ xX])\](?:[ \t]+|$)/
export const DEFINITION_RE =
  /^ {0,3}\[((?:[^\]\\]|\\.)+)\]:[ \t]*(<[^>]*>|\S+)(?:[ \t]+("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\((?:[^)\\]|\\.)*\)))?[ \t]*$/
const DELIMITER_ROW_RE = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/
const HTML_RAW_RE = /^ {0,3}<(script|pre|style|textarea)(?=[\s>]|$)/i
const HTML_COMMENT_RE = /^ {0,3}<!--/
const HTML_BLOCK_TAG_RE =
  /^ {0,3}<\/?(address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?=[\s/>]|$)/i
const HTML_ANY_TAG_RE =
  /^ {0,3}(?:<[a-zA-Z][a-zA-Z0-9-]*(?:\s+[a-zA-Z_:][a-zA-Z0-9_.:-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?>|<\/[a-zA-Z][a-zA-Z0-9-]*\s*>)\s*$/

function isBlank(line: string): boolean {
  return BLANK_RE.test(line)
}

/** Columns of leading whitespace, tabs advancing to the next multiple of four. */
export function indentColumns(line: string): number {
  let width = 0
  for (const ch of line) {
    if (ch === ' ') width++
    else if (ch === '\t') width += 4 - (width % 4)
    else break
  }
  return width
}

/** Splits off the leading whitespace covering `columns` (whole characters only). */
function stripColumns(line: string, columns: number): [prefix: string, rest: string] {
  let width = 0
  let i = 0
  while (i < line.length && width < columns) {
    const ch = line[i]!
    if (ch === ' ') width++
    else if (ch === '\t') width += 4 - (width % 4)
    else break
    i++
  }
  return [line.slice(0, i), line.slice(i)]
}

export interface ListMarker {
  indent: number
  prespace: string
  marker: string
  number: number | null
  delimiter: string | null
  spacing: string
  rest: string
  /** Column the item's content starts at. */
  contentIndent: number
  /** The characters of the line that belong to the marker. */
  prefix: string
  /** The line's content after the marker. */
  inner: string
}

export function matchListMarker(line: string): ListMarker | null {
  const m = LIST_RE.exec(line)
  if (!m) return null
  const prespace = m[1]!
  const marker = m[2] ?? `${m[3]}${m[4]}`
  const spacing = m[5]!
  const rest = line.slice(m[0].length)
  const indent = prespace.length
  let contentIndent: number
  let prefix: string
  let inner: string
  if (rest.length === 0) {
    contentIndent = indent + marker.length + 1
    prefix = line
    inner = ''
  } else if (spacing.length >= 5) {
    contentIndent = indent + marker.length + 1
    prefix = prespace + marker + ' '
    inner = spacing.slice(1) + rest
  } else {
    contentIndent = indent + marker.length + spacing.length
    prefix = prespace + marker + spacing
    inner = rest
  }
  return {
    indent,
    prespace,
    marker,
    number: m[3] ? Number(m[3]) : null,
    delimiter: m[4] ?? null,
    spacing,
    rest,
    contentIndent,
    prefix,
    inner,
  }
}

interface AtxHeading {
  depth: number
  text: string
  pattern: string
}

function matchAtxHeading(line: string): AtxHeading | null {
  const m = ATX_RE.exec(line)
  if (!m) return null
  const indent = m[1]!
  const hashes = m[2]!
  const rest = m[3]!
  const spacing = /^[ \t]*/.exec(rest)![0]
  let body = rest.slice(spacing.length)
  let closing = ''
  const close = /(^|[ \t]+)(#+)[ \t]*$/.exec(body)
  if (close) {
    closing = body.slice(close.index)
    body = body.slice(0, close.index)
  } else {
    const trailing = /[ \t]+$/.exec(body)
    if (trailing) {
      closing = trailing[0]
      body = body.slice(0, trailing.index)
    }
  }
  return { depth: hashes.length, text: body, pattern: `${indent}${hashes}${spacing}{0}${closing}` }
}

interface HtmlStart {
  end: RegExp | null
}

function matchHtmlStart(line: string, paragraphOpen: boolean): HtmlStart | null {
  const raw = HTML_RAW_RE.exec(line)
  if (raw) return { end: new RegExp(`</${raw[1]}>`, 'i') }
  if (HTML_COMMENT_RE.test(line)) return { end: /-->/ }
  if (HTML_BLOCK_TAG_RE.test(line)) return { end: null }
  if (!paragraphOpen && HTML_ANY_TAG_RE.test(line)) return { end: null }
  return null
}

/** Does the line open a block other than a paragraph (used for lazy continuation and tables)? */
function startsBlock(line: string): boolean {
  return (
    FENCE_RE.test(line) ||
    ATX_RE.test(line) ||
    HR_RE.test(line) ||
    QUOTE_RE.test(line) ||
    matchListMarker(line) !== null ||
    matchHtmlStart(line, true) !== null
  )
}

/** Is the last buffered line paragraph text that a lazy line may continue? */
function endsInText(lines: string[]): boolean {
  const last = lines[lines.length - 1]
  if (last === undefined || isBlank(last) || startsBlock(last)) return false
  let fenceOpen: string | null = null
  for (const line of lines) {
    const fence = FENCE_RE.exec(line)
    if (!fence) continue
    const marker = fence[2]!
    if (fenceOpen === null) {
      if (marker[0] === '`' && fence[4]!.includes('`')) continue
      fenceOpen = marker
    } else if (marker[0] === fenceOpen[0] && marker.length >= fenceOpen.length && fence[4]!.length === 0) {
      fenceOpen = null
    }
  }
  return fenceOpen === null
}

// --- table rows --------------------------------------------------------------------------------

export interface SplitRow {
  cells: string[]
  pipeStart: boolean
  pipeEnd: boolean
}

/** Splits a table row on the pipes that are neither escaped nor inside a code span. */
export function splitTableRow(line: string): SplitRow {
  let text = line.trim()
  let pipeStart = false
  let pipeEnd = false
  if (text.startsWith('|')) {
    pipeStart = true
    text = text.slice(1)
  }
  const cells: string[] = []
  let current = ''
  let i = 0
  while (i < text.length) {
    const ch = text[i]!
    if (ch === '\\' && i + 1 < text.length) {
      current += ch + text[i + 1]
      i += 2
      continue
    }
    if (ch === '`') {
      let run = 0
      while (text[i + run] === '`') run++
      const close = text.indexOf('`'.repeat(run), i + run)
      const closeEnd = close === -1 ? -1 : close + run
      if (close !== -1 && text[closeEnd] !== '`') {
        current += text.slice(i, closeEnd)
        i = closeEnd
        continue
      }
      current += text.slice(i, i + run)
      i += run
      continue
    }
    if (ch === '|') {
      cells.push(current)
      current = ''
      i++
      continue
    }
    current += ch
    i++
  }
  if (text.length > 0 && text.endsWith('|') && !text.endsWith('\\|')) {
    pipeEnd = true
  } else {
    cells.push(current)
  }
  return { cells, pipeStart, pipeEnd }
}

function alignmentOf(cell: string): Alignment {
  const text = cell.trim()
  const left = text.startsWith(':')
  const right = text.endsWith(':')
  if (left && right) return 'center'
  if (left) return 'left'
  if (right) return 'right'
  return null
}

// --- the parser --------------------------------------------------------------------------------

type Verdict = 'keep' | 'consumed' | 'close' | 'unknown'

interface OpenItem {
  node: Node
  lines: string[]
  prefixes: string[]
  contentIndent: number
}

type Open =
  | { kind: 'paragraph'; node: Node; lines: string[] }
  | { kind: 'fence'; node: Node; marker: string; lines: string[] }
  | { kind: 'indented'; node: Node; lines: string[]; prefixes: string[]; pendingBlank: string[] }
  | { kind: 'html'; node: Node; lines: string[]; end: RegExp | null }
  | { kind: 'quote'; node: Node; lines: string[]; prefixes: string[] }
  | { kind: 'list'; node: Node; current: OpenItem; between: string[] }
  | { kind: 'table'; node: Node; lines: string[] }

class BlockParser {
  private pos = 0
  private open: Open | null = null
  private readonly nodes: Node[] = []
  private blankRun: string[] = []

  constructor(
    private readonly doc: MarkdownDocument,
    private readonly lines: string[],
    private readonly options: ParseOptions,
  ) {}

  parse(): ParseResult {
    while (this.pos < this.lines.length) {
      const line = this.lines[this.pos]!
      if (this.open) {
        const verdict = this.continueOpen(this.open, line)
        if (verdict === 'keep') {
          this.pos++
          continue
        }
        if (verdict === 'consumed') {
          this.closeOpen()
          this.pos++
          continue
        }
        if (verdict === 'close') {
          this.closeOpen()
          continue
        }
        // A paragraph is open: does the line interrupt it?
        if (this.tryStart(line, true)) continue
        ;(this.open as { lines: string[] }).lines.push(line)
        this.pos++
        continue
      }
      if (isBlank(line)) {
        this.blankRun.push(line)
        this.pos++
        continue
      }
      if (this.tryStart(line, false)) continue
      this.open = { kind: 'paragraph', node: this.create('paragraph'), lines: [line] }
      this.pos++
    }
    this.closeOpen()
    const tail = this.blankRun.length
    const tailLines = this.blankRun.some((blank) => blank.length > 0) ? [...this.blankRun] : undefined
    return { nodes: this.nodes, tail, tailLines }
  }

  /** A node for the block starting here, carrying the blank lines that came before it. */
  private create(type: Node['type']): Node {
    const node = this.doc.createNode(type)
    node.ahead = this.blankRun.length
    if (this.blankRun.some((blank) => blank.length > 0)) node.aheadLines = [...this.blankRun]
    this.blankRun = []
    return node
  }

  private tryStart(line: string, paragraphOpen: boolean): boolean {
    if (line.startsWith('\u200b') && !paragraphOpen) {
      // The guard a save puts before an indented paragraph, so it does not reopen as code (RT-11).
      this.open = { kind: 'paragraph', node: this.create('paragraph'), lines: [line.slice(1)] }
      this.pos++
      return true
    }
    const indent = indentColumns(line)
    if (indent >= 4) {
      if (paragraphOpen || !this.options.indentedCode) return false
      const [prefix, rest] = stripColumns(line, 4)
      const node = this.create('fence')
      node.indented = true
      node.lang = ''
      node.pattern = '    {0}'
      this.open = { kind: 'indented', node, lines: [rest], prefixes: [prefix], pendingBlank: [] }
      this.pos++
      return true
    }

    const fence = FENCE_RE.exec(line)
    if (fence && !(fence[2]![0] === '`' && fence[4]!.includes('`'))) {
      if (paragraphOpen) this.closeOpen()
      const node = this.create('fence')
      node.lang = fence[4]!
      node.pattern = `${fence[1]}${fence[2]}${fence[3]}{0}${fence[5]}`
      this.open = { kind: 'fence', node, marker: fence[2]!, lines: [] }
      this.pos++
      return true
    }

    const heading = matchAtxHeading(line)
    if (heading) {
      if (paragraphOpen) this.closeOpen()
      const node = this.create('heading')
      node.depth = heading.depth
      node.text = heading.text
      node.pattern = heading.pattern
      this.nodes.push(node)
      this.pos++
      return true
    }

    if (HR_RE.test(line)) {
      if (paragraphOpen) this.closeOpen()
      const node = this.create('hr')
      node.pattern = line
      this.nodes.push(node)
      this.pos++
      return true
    }

    const quote = QUOTE_RE.exec(line)
    if (quote) {
      if (paragraphOpen) this.closeOpen()
      const node = this.create('blockquote')
      this.open = { kind: 'quote', node, lines: [line.slice(quote[0].length)], prefixes: [quote[0]] }
      this.pos++
      return true
    }

    const marker = matchListMarker(line)
    if (marker && (!paragraphOpen || (marker.inner.length > 0 && (marker.number === null || marker.number === 1)))) {
      if (paragraphOpen) this.closeOpen()
      const node = this.create('list')
      node.style = marker.number === null ? 'ul' : 'ol'
      if (marker.number === null) node.bullet = marker.marker
      else {
        node.delimiter = marker.delimiter!
        node.start = marker.number
      }
      this.open = { kind: 'list', node, current: this.openItem(marker, 0), between: [] }
      this.pos++
      return true
    }

    const html = matchHtmlStart(line, paragraphOpen)
    if (html) {
      if (paragraphOpen) this.closeOpen()
      const node = this.create('html')
      const lines = [line]
      if (html.end?.test(line)) {
        node.text = line
        this.nodes.push(node)
      } else {
        this.open = { kind: 'html', node, lines, end: html.end }
      }
      this.pos++
      return true
    }

    if (!paragraphOpen && line.includes('|')) {
      const next = this.lines[this.pos + 1]
      if (next !== undefined && next.includes('|') && DELIMITER_ROW_RE.test(next)) {
        const headerCells = splitTableRow(line).cells.length
        const delimiterCells = splitTableRow(next).cells.length
        if (headerCells === delimiterCells) {
          const node = this.create('table')
          this.open = { kind: 'table', node, lines: [line, next] }
          this.pos += 2
          return true
        }
      }
    }

    const definition = !paragraphOpen ? DEFINITION_RE.exec(line) : null
    if (definition) {
      const node = this.create('definition')
      node.ref = definition[1]!
      const target = definition[2]!
      node.href = target.startsWith('<') && target.endsWith('>') ? target.slice(1, -1) : target
      node.title = definition[3] ? definition[3].slice(1, -1) : null
      node.text = line
      this.nodes.push(node)
      this.pos++
      return true
    }

    return false
  }

  private openItem(marker: ListMarker, ahead: number, aheadLines?: string[]): OpenItem {
    const node = this.doc.createNode('list_item')
    node.ahead = ahead
    if (aheadLines) node.aheadLines = aheadLines
    node.prespace = marker.prespace
    node.markerText = marker.marker
    node.markerSpacing = marker.rest.length === 0 ? marker.spacing : marker.spacing.length >= 5 ? ' ' : marker.spacing
    node.subindent = marker.contentIndent
    node.checked = null
    let prefix = marker.prefix
    let inner = marker.inner
    const task = TASK_RE.exec(inner)
    if (task) {
      node.checked = task[1] !== ' '
      node.taskMark = `[${task[1]}]`
      prefix += task[0]
      inner = inner.slice(task[0].length)
    }
    return { node, lines: [inner], prefixes: [prefix], contentIndent: marker.contentIndent }
  }

  private continueOpen(open: Open, line: string): Verdict {
    switch (open.kind) {
      case 'paragraph': {
        if (isBlank(line)) return 'close'
        const setext = SETEXT_RE.exec(line)
        if (setext) {
          open.node.type = 'heading'
          open.node.depth = setext[1]![0] === '=' ? 1 : 2
          open.node.pattern = `{0}\n${line}`
          return 'consumed'
        }
        if (this.openTableAfterParagraph(open, line)) return 'keep'
        return 'unknown'
      }
      case 'fence': {
        const close = /^ {0,3}(`+|~+)[ \t]*$/.exec(line)
        if (close && close[1]![0] === open.marker[0] && close[1]!.length >= open.marker.length) {
          open.node.patternEnd = line
          return 'consumed'
        }
        open.lines.push(line)
        return 'keep'
      }
      case 'indented': {
        if (isBlank(line)) {
          open.pendingBlank.push(line)
          return 'keep'
        }
        if (indentColumns(line) < 4) return 'close'
        for (const blank of open.pendingBlank) {
          open.prefixes.push(blank)
          open.lines.push('')
        }
        open.pendingBlank = []
        const [prefix, rest] = stripColumns(line, 4)
        open.prefixes.push(prefix)
        open.lines.push(rest)
        return 'keep'
      }
      case 'html': {
        if (open.end) {
          open.lines.push(line)
          return open.end.test(line) ? 'consumed' : 'keep'
        }
        if (isBlank(line)) return 'close'
        open.lines.push(line)
        return 'keep'
      }
      case 'quote': {
        const quote = QUOTE_RE.exec(line)
        if (quote) {
          open.prefixes.push(quote[0])
          open.lines.push(line.slice(quote[0].length))
          return 'keep'
        }
        if (isBlank(line) || !endsInText(open.lines) || startsBlock(line)) return 'close'
        open.prefixes.push('')
        open.lines.push(line)
        return 'keep'
      }
      case 'list':
        return this.continueList(open, line)
      case 'table': {
        if (isBlank(line) || startsBlock(line)) return 'close'
        open.lines.push(line)
        return 'keep'
      }
    }
  }

  /**
   * GFM lets a table follow paragraph text directly: when a delimiter row arrives, the paragraph's
   * last line becomes the header row. The paragraph keeps its earlier lines, or goes away entirely.
   */
  private openTableAfterParagraph(open: Open & { kind: 'paragraph' }, line: string): boolean {
    if (!line.includes('|') || !DELIMITER_ROW_RE.test(line)) return false
    const header = open.lines[open.lines.length - 1]!
    if (!header.includes('|') || splitTableRow(header).cells.length !== splitTableRow(line).cells.length) return false
    open.lines.pop()
    const table = this.doc.createNode('table')
    if (open.lines.length === 0) {
      table.ahead = open.node.ahead
      table.aheadLines = open.node.aheadLines
      this.open = null
      this.doc.removeNode(open.node)
    } else {
      table.ahead = 0
      this.closeOpen()
    }
    this.open = { kind: 'table', node: table, lines: [header, line] }
    return true
  }

  private continueList(open: Open & { kind: 'list' }, line: string): Verdict {
    const item = open.current
    if (isBlank(line)) {
      let j = this.pos + 1
      while (j < this.lines.length && isBlank(this.lines[j]!)) j++
      const next = this.lines[j]
      if (next === undefined) return 'close'
      if (indentColumns(next) >= item.contentIndent) {
        // An item that began empty ends at a blank line: at most one blank line may begin an item.
        if (item.lines.length === 1 && item.lines[0] === '') return 'close'
        open.node.loose = true
        item.prefixes.push(line)
        item.lines.push('')
        return 'keep'
      }
      const marker = matchListMarker(next)
      if (marker && indentColumns(next) < item.contentIndent && this.sameList(open.node, marker)) {
        open.node.loose = true
        open.between.push(line)
        return 'keep'
      }
      return 'close'
    }

    const indent = indentColumns(line)
    if (indent >= item.contentIndent) {
      const [prefix, rest] = stripColumns(line, item.contentIndent)
      item.prefixes.push(prefix)
      item.lines.push(rest)
      return 'keep'
    }

    const marker = matchListMarker(line)
    if (marker) {
      if (!this.sameList(open.node, marker)) return 'close'
      this.finishItem(open)
      const between = open.between
      open.between = []
      open.current = this.openItem(
        marker,
        between.length,
        between.some((blank) => blank.length > 0) ? between : undefined,
      )
      return 'keep'
    }

    if (open.between.length === 0 && endsInText(item.lines) && !startsBlock(line)) {
      item.prefixes.push('')
      item.lines.push(line)
      return 'keep'
    }
    return 'close'
  }

  private sameList(list: Node, marker: ListMarker): boolean {
    return list.style === 'ul' ? marker.marker === list.bullet : marker.delimiter === list.delimiter
  }

  private finishItem(open: Open & { kind: 'list' }) {
    const item = open.current
    const inner = parseLines(this.doc, item.lines, this.options)
    this.fillContainer(item.node, inner)
    item.node.userIndent = item.prefixes
    open.node.appendChild(item.node)
    if (inner.nodes.some((node, index) => index > 0 && (node.ahead ?? 0) > 0)) open.node.loose = true
  }

  /** Gives a container its parsed children; one that came out empty gets an empty paragraph to hold a caret. */
  private fillContainer(container: Node, inner: ParseResult) {
    for (const node of inner.nodes) container.appendChild(node)
    if (inner.nodes.length === 0) {
      container.appendChild(this.doc.createNode('paragraph', { ahead: 0 }))
      inner.tail = Math.max(0, inner.tail - 1)
      if (inner.tailLines) inner.tailLines = inner.tailLines.slice(1)
    }
    applyTail(container, inner)
  }

  private closeOpen() {
    const open = this.open
    if (!open) return
    this.open = null
    switch (open.kind) {
      case 'paragraph':
        open.node.text = open.lines.join('\n')
        break
      case 'fence':
        open.node.text = open.lines.join('\n')
        if (open.lines.length === 0) open.node.empty = true
        if (open.node.patternEnd === undefined) open.node.noCloseTag = true
        break
      case 'indented':
        open.node.text = open.lines.join('\n')
        open.node.userIndent = open.prefixes
        this.blankRun.push(...open.pendingBlank)
        break
      case 'html':
        open.node.text = open.lines.join('\n')
        break
      case 'quote': {
        this.fillContainer(open.node, parseLines(this.doc, open.lines, this.options))
        open.node.userIndent = open.prefixes
        break
      }
      case 'list': {
        this.finishItem(open)
        this.blankRun.push(...open.between)
        const items = open.node.children
        if (open.node.style === 'ol') {
          const numbers = items.map((item) => Number.parseInt(item.markerText ?? '', 10))
          open.node.isFixed = items.length > 1 && numbers.every((n) => n === numbers[0])
        }
        if (open.node.loose === undefined) open.node.loose = false
        break
      }
      case 'table':
        this.buildTable(open.node, open.lines)
        break
    }
    this.nodes.push(open.node)
  }

  private buildTable(table: Node, lines: string[]) {
    const [headerLine, delimiterLine, ...bodyLines] = lines as [string, string, ...string[]]
    table.userText = [...lines]
    table.align = splitTableRow(delimiterLine).cells.map(alignmentOf)
    const addRow = (line: string, header: boolean) => {
      const split = splitTableRow(line)
      const row = this.doc.createNode('table_row')
      row.header = header
      row.pipeStart = split.pipeStart
      row.pipeEnd = split.pipeEnd
      for (const cell of split.cells) row.appendChild(this.doc.createNode('table_cell', { text: cell.trim() }))
      table.appendChild(row)
    }
    addRow(headerLine, true)
    for (const line of bodyLines) addRow(line, false)
  }
}

// --- front matter ------------------------------------------------------------------------------

const FRONTMATTER_OPEN_RE = /^(---|= yaml =)[ \t]*$/
const FRONTMATTER_CLOSE_RE = /^(---|\.\.\.|= yaml =)[ \t]*$/

function parseFrontmatter(doc: MarkdownDocument, lines: string[]): { node: Node; lineCount: number } | null {
  const first = lines[0]
  if (first === undefined || !FRONTMATTER_OPEN_RE.test(first)) return null
  for (let i = 1; i < lines.length; i++) {
    if (!FRONTMATTER_CLOSE_RE.test(lines[i]!)) continue
    const body = lines.slice(1, i)
    const node = doc.createNode('frontmatter', { text: body.join('\n'), pattern: first, patternEnd: lines[i]! })
    if (body.length === 0) node.empty = true
    node.ahead = 0
    return { node, lineCount: i + 1 }
  }
  return null
}

// --- block-marker previews (§4.4) ---------------------------------------------------------------

export interface BlockPreview {
  /** What the paragraph would become on commit: `h2`, `fence`, `hr`, `definition`, `table`, `html`. */
  looksLike: string
  /** The marker text at the start of the first line, shown muted; empty when there is none to mute. */
  marker: string
}

const PREVIEW_HEADING_RE = /^(#{1,6})([ \t]+)/
const PREVIEW_FENCE_RE = /^ {0,3}(`{3,}|~{3,})/
const PREVIEW_DEFINITION_RE = /^ {0,3}\[(?:[^\]\\]|\\.)+\]:/

/** A paragraph whose first line looks like a block start that has not been committed (TYP-14, TYP-16). */
export function previewMarker(text: string): BlockPreview | null {
  const newline = text.indexOf('\n')
  const first = newline === -1 ? text : text.slice(0, newline)
  const heading = PREVIEW_HEADING_RE.exec(first)
  if (heading) return { looksLike: `h${heading[1]!.length}`, marker: heading[0] }
  const fence = PREVIEW_FENCE_RE.exec(first)
  if (fence && !(fence[1]![0] === '`' && first.slice(fence[0].length).includes('`'))) {
    return { looksLike: 'fence', marker: fence[0] }
  }
  if (HR_RE.test(first)) return { looksLike: 'hr', marker: first }
  const definition = PREVIEW_DEFINITION_RE.exec(first)
  if (definition && DEFINITION_RE.test(first)) return { looksLike: 'definition', marker: definition[0] }
  if (newline !== -1) {
    const second = text.slice(newline + 1).split('\n')[0]!
    if (first.includes('|') && second.includes('|') && DELIMITER_ROW_RE.test(second)) {
      return { looksLike: 'table', marker: '' }
    }
    const setext = SETEXT_RE.exec(second)
    if (setext) return { looksLike: setext[1]![0] === '=' ? 'h1' : 'h2', marker: '' }
  }
  if (matchHtmlStart(first, false)) return { looksLike: 'html', marker: '' }
  return null
}
