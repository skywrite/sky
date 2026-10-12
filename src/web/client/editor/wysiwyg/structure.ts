/**
 * Block-level transitions on the model and the DOM together (architecture §8.2): a paragraph that
 * became a list item or a quote as it was typed, a previewed marker committed by re-parsing, and
 * the caret carried across.
 */

import type { Bookmark } from './bookmark.ts'
import { elementFor } from './bookmark.ts'
import type { MarkdownDocument, Node } from './model.ts'
import { DEFINITION_RE, type ListMarker, matchListMarker, reparseBlock } from './parser.ts'
import { type RenderContext, renderBlock } from './render.ts'
import { defaultAhead, serializeNode } from './serializer.ts'

const QUOTE_MARK_RE = /^ {0,3}> /
const TASK_MARK_RE = /^\[([ xX])\] /

export interface Transition {
  /** The leaf that now holds the text the caret was in. */
  leaf: Node
  /** Characters removed before the caret's line start plus the consumed marker. */
  bookmark: Bookmark | null
}

/** Links `replacements` where `node` sits and drops `node`; the first replacement keeps its spacing. */
export function replaceNode(doc: MarkdownDocument, node: Node, replacements: Node[]) {
  const first = replacements[0]
  if (first && first.ahead === undefined) {
    first.ahead = node.ahead
    first.aheadLines = node.aheadLines
  }
  for (const replacement of replacements) node.addBefore(replacement)
  doc.removeNode(node)
}

/** The ids of the top-level blocks around a node — anchors for re-rendering whatever changes between them. */
export function anchorsAround(...nodes: Node[]): { before: string | null; after: string | null } {
  const tops = nodes.map((node) => node.topLevel()).filter((top): top is Node => top !== null)
  const first = tops[0]
  const last = tops[tops.length - 1]
  return { before: first?.before?.id ?? null, after: last?.after?.id ?? null }
}

/**
 * Re-renders the top-level blocks between two anchors — the document's start or end when an
 * anchor is null — from the model, replacing whatever the DOM held there.
 */
export function syncRange(
  root: HTMLElement,
  doc: MarkdownDocument,
  anchors: { before: string | null; after: string | null },
  context: RenderContext,
) {
  const startElement = anchors.before ? elementFor(root, anchors.before) : null
  const endElement = anchors.after ? elementFor(root, anchors.after) : null
  let cursor = startElement ? startElement.nextSibling : root.firstChild
  while (cursor && cursor !== endElement) {
    const next = cursor.nextSibling
    cursor.remove()
    cursor = next
  }
  const nodes: Node[] = []
  const startNode = anchors.before ? doc.getNode(anchors.before)?.after : doc.root.firstChild
  for (let node = startNode ?? null; node && node.id !== anchors.after; node = node.after) nodes.push(node)
  const html = nodes.map((node) => renderBlock(node, context)).join('')
  if (endElement) endElement.insertAdjacentHTML('beforebegin', html)
  else root.insertAdjacentHTML('beforeend', html)
}

// --- immediate conversions (TYP-9 … TYP-13) --------------------------------------------------

/**
 * Looks at the caret's line of a paragraph for a list, quote or task marker. When one is there,
 * the paragraph changes shape in the model and the DOM, and the transition says where the caret
 * now belongs. Null when nothing changed.
 */
export function convertImmediate(doc: MarkdownDocument, node: Node, bookmark: Bookmark | null): Transition | null {
  if (node.type !== 'paragraph' || !node.parent) return null
  const text = node.text
  const lines = text.split('\n')
  const caret = bookmark && bookmark.blockId === node.id ? bookmark.start : 0
  const lineIndex = lineIndexAt(text, caret)
  const lineStart = lineStartOffset(text, lineIndex)
  const line = lines[lineIndex]!

  const task = lineIndex === 0 ? TASK_MARK_RE.exec(line) : null
  const item = node.parent.type === 'list_item' && node.parent.firstChild === node ? node.parent : null
  if (task && item && item.checked == null && item.parent?.style === 'ul') {
    item.checked = task[1] !== ' '
    item.taskMark = `[${task[1]}]`
    if (item.userIndent?.[0] !== undefined) item.userIndent[0] += task[0]
    node.text = text.slice(task[0].length)
    return { leaf: node, bookmark: shifted(bookmark, node.id, task[0].length) }
  }

  const marker = matchListMarker(line)
  if (marker && marker.spacing.length > 0 && marker.inner.length === line.length - marker.prefix.length) {
    return convertToListItem(doc, node, lines, lineIndex, lineStart, marker, bookmark)
  }

  const quote = QUOTE_MARK_RE.exec(line)
  if (quote) {
    return convertToQuote(doc, node, lines, lineIndex, lineStart, quote[0].length, bookmark)
  }
  return null
}

function convertToListItem(
  doc: MarkdownDocument,
  node: Node,
  lines: string[],
  lineIndex: number,
  lineStart: number,
  marker: ListMarker,
  bookmark: Bookmark | null,
): Transition {
  const style = marker.number === null ? 'ul' : 'ol'
  const item = doc.createNode('list_item', {
    checked: null,
    prespace: marker.prespace,
    markerSpacing: marker.spacing.length >= 5 ? ' ' : marker.spacing,
    subindent: marker.contentIndent,
  })
  const { leaf, consumed } = splitOff(doc, node, lines, lineIndex, marker.prefix.length)

  const previous = lineIndex === 0 ? node.before : null
  const joins =
    previous?.type === 'list' &&
    previous.style === style &&
    (style === 'ul' ? previous.bullet === marker.marker : previous.delimiter === marker.delimiter)
  if (joins && previous) {
    // The paragraph becomes the last item of the list right before it.
    item.ahead = node.ahead
    if ((node.ahead ?? 0) > 0) previous.loose = true
    node.ahead = 0
    node.aheadLines = undefined
    previous.appendChild(item)
    item.appendChild(node)
    return { leaf, bookmark: shifted(bookmark, leaf.id, lineStart + consumed) }
  }

  const list = doc.createNode('list', { style, loose: false })
  if (style === 'ul') list.bullet = marker.marker
  else {
    list.delimiter = marker.delimiter ?? '.'
    list.start = marker.number ?? 1
  }
  list.appendChild(item)
  placeBlock(node, leaf, lineIndex, list, item)
  return { leaf, bookmark: shifted(bookmark, leaf.id, lineStart + consumed) }
}

function convertToQuote(
  doc: MarkdownDocument,
  node: Node,
  lines: string[],
  lineIndex: number,
  lineStart: number,
  markerLength: number,
  bookmark: Bookmark | null,
): Transition {
  const { leaf, consumed } = splitOff(doc, node, lines, lineIndex, markerLength)
  const quote = doc.createNode('blockquote')
  placeBlock(node, leaf, lineIndex, quote, quote)
  return { leaf, bookmark: shifted(bookmark, leaf.id, lineStart + consumed) }
}

/**
 * The paragraph's lines from `lineIndex` on, minus the marker, become the leaf of the new block:
 * the paragraph itself when the marker was on its first line, a new paragraph otherwise. Only
 * text changes here; the tree is rearranged by `placeBlock`.
 */
function splitOff(
  doc: MarkdownDocument,
  node: Node,
  lines: string[],
  lineIndex: number,
  markerLength: number,
): { leaf: Node; consumed: number } {
  const rest = [lines[lineIndex]!.slice(markerLength), ...lines.slice(lineIndex + 1)].join('\n')
  if (lineIndex === 0) {
    node.text = rest
    return { leaf: node, consumed: markerLength }
  }
  node.text = lines.slice(0, lineIndex).join('\n')
  return { leaf: doc.createNode('paragraph', { text: rest }), consumed: markerLength }
}

/**
 * Puts `block` (whose `holder` takes the leaf) where the paragraph was when the marker sat on its
 * first line — the paragraph moves inside — or right after the paragraph otherwise.
 */
function placeBlock(node: Node, leaf: Node, lineIndex: number, block: Node, holder: Node) {
  if (lineIndex === 0) {
    block.ahead = node.ahead
    block.aheadLines = node.aheadLines
    node.ahead = 0
    node.aheadLines = undefined
    node.addBefore(block)
    holder.appendChild(node)
    return
  }
  block.ahead = 0
  holder.appendChild(leaf)
  node.addAfter(block)
}

function shifted(bookmark: Bookmark | null, leafId: string, consumed: number): Bookmark | null {
  if (!bookmark) return null
  const start = Math.max(0, bookmark.start - consumed)
  const end = Math.max(start, bookmark.end - consumed)
  return { blockId: leafId, start, end }
}

// --- commit: re-parse a paragraph (TYP-15 … TYP-17) --------------------------------------------

/**
 * Re-parses a paragraph's text as blocks. When it is no longer one paragraph — a previewed
 * heading, a fence, a rule, a definition, a table, or lines that split into several blocks — the
 * new blocks replace it in the model and the DOM. Null when it stays as it is.
 */
export function commitBlock(doc: MarkdownDocument, node: Node, bookmark: Bookmark | null): Transition | null {
  if (node.type !== 'paragraph' || !node.parent) return null
  const nodes = reparseBlock(doc, node)
  if (!nodes) return null
  const oldText = node.text
  const oldId = node.id
  replaceNode(doc, node, nodes)
  const caret = bookmark && bookmark.blockId === oldId ? bookmark.start : null
  return caretAfterReparse(oldText, caret, nodes)
}

/**
 * Where a caret at `offset` in the old text lands among the blocks that replaced it: the leaf
 * whose serialized lines cover the caret's line, at the caret's column minus that line's prefix.
 */
export function caretAfterReparse(oldText: string, offset: number | null, nodes: Node[]): Transition {
  const firstLeaf = nodes[0]!.firstLeaf()
  if (offset === null) return { leaf: firstLeaf, bookmark: null }
  const lineIndex = lineIndexAt(oldText, offset)
  const column = offset - lineStartOffset(oldText, lineIndex)
  const cursor = { line: 0 }
  let previous: Node | null = null
  for (const block of nodes) {
    if (previous) cursor.line += block.ahead ?? 1
    const found = locateLine(block, lineIndex, column, cursor, serializeNode(block), cursor.line)
    if (found) return found
    previous = block
  }
  const end = firstLeaf.text.length
  return { leaf: firstLeaf, bookmark: { blockId: firstLeaf.id, start: end, end } }
}

/**
 * Walks a block's serialized lines, blank lines included, looking for the caret's line. The
 * line's prefix — list marker, quote mark, indent — is what the top-level block's serialized line
 * carries beyond the leaf's own text.
 */
function locateLine(
  block: Node,
  lineIndex: number,
  column: number,
  cursor: { line: number },
  fullLines: string[],
  blockStart: number,
): Transition | null {
  if (block.isLeaf()) {
    const serialized = serializeNode(block)
    const textLines = block.text.split('\n')
    for (let i = 0; i < serialized.length; i++, cursor.line++) {
      if (cursor.line !== lineIndex) continue
      if (block.type === 'hr') return null
      const textIndex = Math.min(i, textLines.length - 1)
      const textLine = textLines[textIndex] ?? ''
      const fullLine = fullLines[lineIndex - blockStart] ?? serialized[i]!
      const prefix = Math.max(0, fullLine.length - textLine.length)
      const at = lineStartOffset(block.text, textIndex) + Math.min(textLine.length, Math.max(0, column - prefix))
      return { leaf: block, bookmark: { blockId: block.id, start: at, end: at } }
    }
    return null
  }
  let previous: Node | null = null
  for (const child of block.children) {
    cursor.line += child.ahead ?? defaultAhead(block, previous, child)
    const found = locateLine(child, lineIndex, column, cursor, fullLines, blockStart)
    if (found) return found
    previous = child
  }
  cursor.line += block.tail ?? 0
  return null
}

export function lineIndexAt(text: string, offset: number): number {
  let index = 0
  for (let i = 0; i < Math.min(offset, text.length); i++) if (text[i] === '\n') index++
  return index
}

export function lineStartOffset(text: string, lineIndex: number): number {
  let offset = 0
  for (let i = 0; i < lineIndex; i++) {
    const newline = text.indexOf('\n', offset)
    if (newline === -1) return text.length
    offset = newline + 1
  }
  return offset
}

// --- verbatim leaves on leave ------------------------------------------------------------------

/**
 * A verbatim block the caret left: a definition re-reads its fields from its line, and a raw HTML
 * block re-parses — either may have stopped being what it was, and then becomes paragraphs.
 */
export function storeVerbatim(doc: MarkdownDocument, node: Node): Transition | null {
  if (node.type === 'definition') {
    const match = DEFINITION_RE.exec(node.text)
    if (match) {
      node.ref = match[1]!
      const target = match[2]!
      node.href = target.startsWith('<') && target.endsWith('>') ? target.slice(1, -1) : target
      node.title = match[3] ? match[3].slice(1, -1) : null
      return null
    }
  } else if (node.type !== 'html') {
    return null
  }
  const nodes = reparseBlock(doc, node)
  if (!nodes) return null
  replaceNode(doc, node, nodes)
  return { leaf: nodes[0]!.firstLeaf(), bookmark: null }
}
