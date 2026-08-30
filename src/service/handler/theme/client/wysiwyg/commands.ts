/**
 * Block-level commands on the model (architecture §11.2, behavior FMT-7 … FMT-10): heading levels,
 * quote and list toggles. Model only; the caller re-renders.
 */

import { renumberAfter } from './lists.ts'
import type { ListStyle, MarkdownDocument, Node } from './model.ts'

export interface Landing {
  leaf: Node
  offset: number
}

/**
 * Makes a block a heading of `depth`, or a paragraph when `depth` is null or equals its level
 * (FMT-7). A multi-line paragraph keeps its other lines as paragraphs around the heading.
 */
export function setHeading(doc: MarkdownDocument, leaf: Node, depth: number | null, caret: number): Landing | null {
  if (leaf.type !== 'paragraph' && leaf.type !== 'heading') return null
  const wanted = depth !== null && !(leaf.type === 'heading' && leaf.depth === depth) ? depth : null
  if (leaf.type === 'paragraph' && leaf.text.includes('\n') && wanted !== null) {
    const lines = leaf.text.split('\n')
    let lineIndex = 0
    let lineStart = 0
    for (let i = 0; i < lines.length; i++) {
      const next = lineStart + lines[i]!.length + 1
      if (caret < next || i === lines.length - 1) {
        lineIndex = i
        break
      }
      lineStart = next
    }
    const before = lines.slice(0, lineIndex).join('\n')
    const after = lines.slice(lineIndex + 1).join('\n')
    const heading = doc.createNode('heading', { depth: wanted, text: lines[lineIndex]! })
    leaf.addAfter(heading)
    if (after.length > 0) heading.addAfter(doc.createNode('paragraph', { text: after }))
    if (before.length > 0) leaf.text = before
    else doc.removeNode(leaf)
    return { leaf: heading, offset: Math.max(0, caret - lineStart) }
  }
  const text = leaf.text
  leaf.clearAttrs()
  leaf.text = text
  if (wanted === null) {
    leaf.type = 'paragraph'
  } else {
    leaf.type = 'heading'
    leaf.depth = wanted
  }
  return { leaf, offset: Math.min(caret, text.length) }
}

/** The blocks a selection of leaves covers, as siblings under one container: each leaf's ancestor at the first leaf's level. */
function siblingBlocks(leaves: Node[]): Node[] {
  const first = leaves[0]
  if (!first?.parent) return []
  const container = first.parent
  const blocks: Node[] = []
  for (const leaf of leaves) {
    let block: Node | null = leaf
    while (block && block.parent !== container) block = block.parent
    if (block && !blocks.includes(block)) blocks.push(block)
  }
  return blocks
}

/** Wraps the selected blocks in a quote, or lifts them out when they sit directly in one (FMT-9). */
export function toggleQuote(doc: MarkdownDocument, leaves: Node[]): boolean {
  const blocks = siblingBlocks(leaves)
  const first = blocks[0]
  if (!first?.parent) return false
  const container = first.parent
  if (container.type === 'blockquote' && container.parent) {
    const children = container.children
    let anchor: Node = container
    for (const child of children) {
      anchor.addAfter(child)
      anchor = child
      child.ahead = undefined
      child.aheadLines = undefined
    }
    doc.removeNode(container)
    return true
  }
  const quote = doc.createNode('blockquote')
  first.addBefore(quote)
  for (const block of blocks) quote.appendChild(block)
  quote.ahead = first.ahead
  first.ahead = 0
  return true
}

export type ListKind = ListStyle | 'task'

/** The list kind the selected leaves are in, when every one is the first paragraph of an item. */
export function currentListKind(leaves: Node[]): ListKind | null {
  let kind: ListKind | null = null
  for (const leaf of leaves) {
    const item = leaf.parent?.type === 'list_item' && leaf.parent.firstChild === leaf ? leaf.parent : null
    const list = item?.parent
    if (!item || !list) return null
    const here: ListKind = item.checked != null ? 'task' : (list.style ?? 'ul')
    if (kind !== null && kind !== here) return null
    kind = here
  }
  return kind
}

/**
 * Bullet, numbered and task toggles (FMT-10): blocks become items, one per line of a paragraph;
 * the current kind applied again unwraps; another kind rewrites the list in place.
 */
export function toggleList(doc: MarkdownDocument, leaves: Node[], kind: ListKind, caret = 0): Landing | null {
  const first = leaves[0]
  if (!first) return null
  const stays: Landing = { leaf: first, offset: caret }
  const current = currentListKind(leaves)
  if (current !== null) {
    const items = [...new Set(leaves.map((leaf) => leaf.parent!))]
    const list = items[0]!.parent!
    if (current === kind) {
      // Unwrap: the items' blocks leave the list at its level, the list split around them.
      const trailingItems: Node[] = []
      for (let next = items[items.length - 1]!.after; next; next = next.after) trailingItems.push(next)
      let anchor: Node = list
      for (const item of items) {
        for (const child of item.children) {
          anchor.addAfter(child)
          anchor = child
          child.ahead = undefined
          child.aheadLines = undefined
        }
        doc.removeNode(item)
      }
      if (trailingItems.length > 0) {
        const trailing = doc.createNode('list', {
          style: list.style ?? 'ul',
          bullet: list.bullet,
          delimiter: list.delimiter,
          loose: list.loose ?? false,
        })
        if (list.style === 'ol') trailing.start = (list.start ?? 1) + list.childCount
        for (const item of trailingItems) trailing.appendChild(item)
        anchor.addAfter(trailing)
      }
      if (!list.firstChild) doc.removeNode(list)
      return stays
    }
    if (kind === 'task') {
      for (const item of list.children) if (item.checked == null) item.checked = false
      return stays
    }
    // ul ↔ ol, or a task list losing its boxes.
    const style: ListStyle = kind
    if (current === 'task' && style === (list.style ?? 'ul')) {
      for (const item of list.children) {
        item.checked = null
        item.taskMark = undefined
        if (item.userIndent?.[0] !== undefined) item.userIndent[0] = item.userIndent[0].replace(/\[[ xX]\][ \t]*$/, '')
      }
      return stays
    }
    list.style = style
    list.isFixed = undefined
    list.userText = undefined
    if (style === 'ol') {
      list.delimiter = '.'
      list.start = 1
      list.bullet = undefined
    } else {
      list.bullet = '-'
      list.delimiter = undefined
      list.start = undefined
    }
    for (const item of list.children) {
      item.markerText = undefined
      item.userIndent = undefined
      item.prespace = ''
      item.markerSpacing = ' '
      item.subindent = undefined
    }
    return stays
  }
  const blocks = siblingBlocks(leaves)
  const firstBlock = blocks[0]
  if (!firstBlock?.parent) return null
  let landing: Landing = stays
  const style: ListStyle = kind === 'ol' ? 'ol' : 'ul'
  const list = doc.createNode('list', { style, loose: false })
  if (style === 'ol') {
    list.delimiter = '.'
    list.start = 1
  } else list.bullet = '-'
  list.ahead = firstBlock.ahead
  firstBlock.addBefore(list)
  for (const block of blocks) {
    const texts = block.type === 'paragraph' ? block.text.split('\n') : null
    if (texts && texts.length > 1) {
      let lineStart = 0
      for (const line of texts) {
        const item = doc.createNode('list_item', { checked: kind === 'task' ? false : null, ahead: 0 })
        const paragraph = doc.createNode('paragraph', { text: line, ahead: 0 })
        item.appendChild(paragraph)
        list.appendChild(item)
        // The caret follows its line into the item made from it.
        if (block === first && caret >= lineStart && caret <= lineStart + line.length) {
          landing = { leaf: paragraph, offset: caret - lineStart }
        }
        lineStart += line.length + 1
      }
      doc.removeNode(block)
      continue
    }
    const item = doc.createNode('list_item', { checked: kind === 'task' ? false : null, ahead: 0 })
    block.ahead = 0
    block.aheadLines = undefined
    item.appendChild(block)
    list.appendChild(item)
  }
  renumberAfter(list.firstChild!)
  return landing
}

/**
 * Moves the caret's block past its neighbor (FMT-13): a list item moves as a whole, a table row
 * within its table, any other block among its siblings. False when there is nothing to swap with.
 */
export function moveBlock(leaf: Node, direction: -1 | 1): boolean {
  let block: Node = leaf
  if (leaf.type === 'table_cell') block = leaf.parent!
  else if (leaf.parent?.type === 'list_item' && leaf.parent.firstChild === leaf) block = leaf.parent
  else
    while (
      block.parent &&
      block.parent.type !== 'document' &&
      block.parent.type !== 'blockquote' &&
      block.parent.type !== 'list_item'
    )
      block = block.parent
  const neighbor = direction === -1 ? block.before : block.after
  if (!neighbor) return false
  if (block.type === 'table_row' && (block.header || neighbor.header)) return false
  const ahead = block.ahead
  block.ahead = neighbor.ahead
  neighbor.ahead = ahead
  if (direction === -1) neighbor.addBefore(block)
  else neighbor.addAfter(block)
  if (block.type === 'list_item') {
    block.markerText = undefined
    neighbor.markerText = undefined
  }
  if (block.type === 'table_row') block.parent!.userText = undefined
  return true
}
