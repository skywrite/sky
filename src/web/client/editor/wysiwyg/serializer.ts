/**
 * Model → Markdown (architecture §10). Each node serializes to lines; the document joins them with
 * the file's line ending. Wherever a node still carries the author's spelling — marker pattern,
 * per-line prefixes, blank-line counts — that spelling wins, and only what the user changed is
 * regenerated (RT-4).
 */

import type { Alignment, MarkdownDocument, Node } from './model.ts'

export function serializeDocument(doc: MarkdownDocument): string {
  const lines = serializeChildren(doc.root)
  const text = lines.join(doc.lineEnding)
  return doc.finalNewline && lines.length > 0 ? text + doc.lineEnding : text
}

/** The lines of a container's children, with the blank lines between and after them. */
export function serializeChildren(container: Node): string[] {
  const lines: string[] = []
  let previous: Node | null = null
  for (const child of container.children) {
    lines.push(...blankLines(child.ahead ?? defaultAhead(container, previous, child), child.aheadLines))
    lines.push(...serializeNode(child))
    previous = child
  }
  lines.push(...blankLines(container.tail ?? 0, container.tailLines))
  return lines
}

export function serializeNode(node: Node): string[] {
  switch (node.type) {
    case 'paragraph': {
      const lines = node.text.split('\n')
      // A paragraph that starts with an indent gets an invisible guard, or it would reopen as code (RT-11).
      if (/^( {4,}|\t)/.test(lines[0] ?? '') && node.parent?.type === 'document') lines[0] = `\u200b${lines[0]}`
      return lines
    }
    case 'html':
      return node.text.split('\n')
    case 'heading':
      return fill(node.pattern ?? `${'#'.repeat(node.depth ?? 1)} {0}`, node.text).split('\n')
    case 'hr':
      return [node.pattern ?? '---']
    case 'fence':
      return serializeFence(node)
    case 'definition':
      return [node.text.length > 0 ? node.text : definitionLine(node)]
    case 'frontmatter':
      return [node.pattern ?? '---', ...bodyLines(node), node.patternEnd ?? '---']
    case 'blockquote':
      return serializeQuote(node)
    case 'list':
      return serializeList(node)
    case 'list_item':
      return node.parent ? serializeItem(node.parent, node, node.index) : serializeChildren(node)
    case 'table':
      return serializeTable(node)
    case 'table_row':
    case 'table_cell':
    case 'document':
      return serializeChildren(node)
  }
}

function fill(pattern: string, text: string): string {
  return pattern.replace('{0}', () => text)
}

function blankLines(count: number, verbatim?: string[]): string[] {
  if (verbatim && verbatim.length === count) return [...verbatim]
  return Array.from({ length: count }, () => '')
}

/**
 * The spacing a block gets when nothing was recorded: none in tight lists, none between an item's
 * paragraph and the list nested under it, one blank line otherwise.
 */
export function defaultAhead(container: Node, previous: Node | null, child?: Node): number {
  if (!previous) return 0
  // Two paragraphs in a row are one paragraph without a blank line between them.
  if (previous.type === 'paragraph' && child?.type === 'paragraph') return 1
  if (container.type === 'list') return container.loose ? 1 : 0
  if (container.type === 'list_item') {
    if (child?.type === 'list' && previous.type === 'paragraph') return 0
    return container.parent?.loose ? 1 : 0
  }
  if (container.type === 'table' || container.type === 'table_row') return 0
  return 1
}

/** A fence's or front matter's body: no lines when it was written empty, else its text's lines. */
function bodyLines(node: Node): string[] {
  return node.empty && node.text === '' ? [] : node.text.split('\n')
}

// --- fences ------------------------------------------------------------------------------------

const FENCE_MARKER_RE = /`{3,}|~{3,}/

function serializeFence(node: Node): string[] {
  const body = bodyLines(node)
  if (node.indented) {
    const prefixes = node.userIndent
    return body.map(
      (line, i) => (prefixes && prefixes.length === body.length ? prefixes[i]! : line.length ? '    ' : '') + line,
    )
  }
  let pattern = node.pattern ?? '```{0}'
  let closer = node.patternEnd ?? pattern.slice(0, pattern.indexOf('{0}')).trimEnd()
  const marker = FENCE_MARKER_RE.exec(pattern)?.[0]
  if (marker) {
    const longest = longestClosingRun(body, marker[0]!)
    if (longest >= marker.length) {
      const grown = marker[0]!.repeat(longest + 1)
      pattern = pattern.replace(marker, grown)
      closer = closer.replace(FENCE_MARKER_RE, (run) => (run.length > longest ? run : grown))
    }
  }
  const lines = [fill(pattern, node.lang ?? ''), ...body]
  if (!node.noCloseTag) lines.push(closer)
  return lines
}

/** The longest run of the fence character standing alone on a body line — what could close the fence early. */
function longestClosingRun(body: string[], ch: string): number {
  let longest = 0
  for (const line of body) {
    const m = /^ {0,3}(`+|~+)[ \t]*$/.exec(line)
    if (m && m[1]![0] === ch) longest = Math.max(longest, m[1]!.length)
  }
  return longest
}

function definitionLine(node: Node): string {
  const title = node.title == null ? '' : ` "${node.title}"`
  return `[${node.ref ?? ''}]: ${node.href ?? ''}${title}`
}

// --- containers --------------------------------------------------------------------------------

function serializeQuote(node: Node): string[] {
  const inner = serializeChildren(node)
  const prefixes = node.userIndent
  if (prefixes && prefixes.length === inner.length) return inner.map((line, i) => prefixes[i]! + line)
  return inner.map((line) => (line.length === 0 ? '>' : `> ${line}`))
}

function serializeList(list: Node): string[] {
  const lines: string[] = []
  list.children.forEach((item, index) => {
    const ahead = item.ahead ?? (index === 0 ? 0 : list.loose ? 1 : 0)
    lines.push(...blankLines(ahead, item.aheadLines))
    lines.push(...serializeItem(list, item, index))
  })
  lines.push(...blankLines(list.tail ?? 0, list.tailLines))
  return lines
}

/** The marker an item would get if it were regenerated: its own number or bullet, or the list's. */
export function itemMarker(list: Node, item: Node, index: number): string {
  if (list.style === 'ol') {
    const start = list.start ?? 1
    if (list.isFixed) return `${start}${list.delimiter ?? '.'}`
    return item.markerText ?? `${start + index}${list.delimiter ?? '.'}`
  }
  return item.markerText ?? list.bullet ?? '-'
}

function serializeItem(list: Node, item: Node, index: number): string[] {
  const inner = serializeChildren(item)
  const marker = itemMarker(list, item, index)
  const head = itemHead(item, marker)
  const prefixes = item.userIndent
  if (prefixes && prefixes.length === inner.length) {
    return inner.map((line, i) => (i === 0 ? head : prefixes[i]!) + line)
  }
  const subindent = item.subindent ?? head.length
  return inner.map((line, i) => (i === 0 ? head : line.length === 0 ? '' : ' '.repeat(subindent)) + line)
}

/** The item's first-line prefix: the original when marker and task state are unchanged, else rebuilt. */
function itemHead(item: Node, marker: string): string {
  const original = item.userIndent?.[0]
  const originalTask = item.taskMark ?? ''
  const originalChecked = originalTask === '' ? null : originalTask !== '[ ]'
  const wantedTask =
    item.checked == null ? '' : item.checked === originalChecked ? originalTask : item.checked ? '[x]' : '[ ]'
  if (original !== undefined && item.markerText === marker && wantedTask === originalTask) return original
  return `${item.prespace ?? ''}${marker}${item.markerSpacing ?? ' '}${wantedTask ? `${wantedTask} ` : ''}`
}

// --- tables ------------------------------------------------------------------------------------

function serializeTable(table: Node): string[] {
  if (table.userText) return [...table.userText]
  const rows = table.children
  const columns = Math.max(table.align?.length ?? 0, ...rows.map((row) => row.childCount))
  const align: Alignment[] = Array.from({ length: columns }, (_, c) => table.align?.[c] ?? null)
  const cells = rows.map((row) => {
    const texts = row.children.map((cell) => escapePipes(cell.text))
    while (texts.length < columns) texts.push('')
    return texts
  })
  const widths = align.map((_, c) => Math.max(3, ...cells.map((row) => displayWidth(row[c]!))))
  const lines: string[] = []
  cells.forEach((row, r) => {
    lines.push(`| ${row.map((text, c) => pad(text, widths[c]!, align[c]!)).join(' | ')} |`)
    if (r === 0) lines.push(`| ${widths.map((width, c) => delimiterCell(width, align[c]!)).join(' | ')} |`)
  })
  if (rows.length === 0) {
    lines.push(`| ${widths.map(() => '').join(' | ')} |`)
  }
  return lines
}

/** Escapes the pipes a cell's text holds outside code spans, so they stay literal (TBL-1). */
export function escapePipes(text: string): string {
  let out = ''
  let i = 0
  while (i < text.length) {
    const ch = text[i]!
    if (ch === '\\' && i + 1 < text.length) {
      out += ch + text[i + 1]
      i += 2
      continue
    }
    if (ch === '`') {
      let run = 0
      while (text[i + run] === '`') run++
      const close = text.indexOf('`'.repeat(run), i + run)
      const closeEnd = close === -1 ? -1 : close + run
      if (close !== -1 && text[closeEnd] !== '`') {
        out += text.slice(i, closeEnd)
        i = closeEnd
        continue
      }
      out += text.slice(i, i + run)
      i += run
      continue
    }
    out += ch === '|' ? '\\|' : ch
    i++
  }
  return out
}

function pad(text: string, width: number, align: Alignment): string {
  const gap = Math.max(0, width - displayWidth(text))
  if (align === 'right') return ' '.repeat(gap) + text
  if (align === 'center') return ' '.repeat(Math.floor(gap / 2)) + text + ' '.repeat(gap - Math.floor(gap / 2))
  return text + ' '.repeat(gap)
}

function delimiterCell(width: number, align: Alignment): string {
  if (align === 'left') return `:${'-'.repeat(width - 1)}`
  if (align === 'right') return `${'-'.repeat(width - 1)}:`
  if (align === 'center') return `:${'-'.repeat(width - 2)}:`
  return '-'.repeat(width)
}

/** Terminal-style display width: East Asian wide and fullwidth characters count double. */
export function displayWidth(text: string): number {
  let width = 0
  for (const ch of text) {
    const cp = ch.codePointAt(0)!
    if (cp < 0x1100) width += 1
    else if (
      cp <= 0x115f ||
      (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe30 && cp <= 0xfe4f) ||
      (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6) ||
      (cp >= 0x1f300 && cp <= 0x1faff) ||
      cp >= 0x20000
    )
      width += 2
    else width += 1
  }
  return width
}
