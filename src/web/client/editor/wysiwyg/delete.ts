/**
 * Backspace and Delete at block edges, and selections that span blocks (architecture §8.3, §8.4).
 * Inside a block the browser deletes; here the structure changes. Model only.
 */

import { type InlineNode, type LexContext, lexInline, sourceOf } from './lexer.ts'
import { liftFirstItem, unnest } from './lists.ts'
import type { MarkdownDocument, Node } from './model.ts'
import { clearCells, clearCellsFrom, clearCellsUpTo, isTableEmpty, nextCell, previousCell } from './tables.ts'

export interface Landing {
  leaf: Node
  offset: number
}

/** Turns a heading, definition, front matter or short fence into a paragraph with its text (DEL-12). */
function becomeParagraph(node: Node) {
  const text = node.text
  node.clearAttrs()
  node.type = 'paragraph'
  node.text = text
}

/**
 * Backspace with the caret at the start of a leaf: the first applicable rule of the chain wins
 * (DEL-6 … DEL-14). Null when nothing applies.
 */
export function backspaceAtStart(doc: MarkdownDocument, leaf: Node): Landing | null {
  const parent = leaf.parent
  if (!parent) return null
  if (leaf.type === 'table_cell') {
    // DEL-6: the previous cell's end; the first cell of an all-empty table deletes the table.
    const previousCellNode = previousCell(leaf)
    if (previousCellNode) return { leaf: previousCellNode, offset: previousCellNode.text.length }
    const table = parent.parent
    if (!table || !isTableEmpty(table)) return null
    const before = table.previousLeaf()
    const neighbor = before ?? table.nextLeaf()
    doc.removeWithEmptyAncestors(table)
    return neighbor && neighbor.type !== 'hr'
      ? { leaf: neighbor, offset: neighbor === before ? neighbor.text.length : 0 }
      : null
  }
  const previous = leaf.previousLeaf()

  // DEL-7 / DEL-8: a rule or an empty paragraph right before goes; the caret stays.
  if (previous?.type === 'hr') {
    doc.removeWithEmptyAncestors(previous)
    return { leaf, offset: 0 }
  }
  if (leaf.before?.type === 'paragraph' && leaf.before.text.length === 0 && leaf.text.length > 0) {
    doc.removeNode(leaf.before)
    return { leaf, offset: 0 }
  }

  const item = parent.type === 'list_item' && parent.firstChild === leaf ? parent : null
  // DEL-9: a task item loses its box.
  if (item && item.checked != null) {
    item.checked = null
    item.taskMark = undefined
    if (item.userIndent?.[0] !== undefined) item.userIndent[0] = item.userIndent[0].replace(/\[[ xX]\][ \t]*$/, '')
    return { leaf, offset: 0 }
  }
  // DEL-10: the first block of a quote, or the first item of a list, leaves its container.
  if (parent.type === 'blockquote' && parent.firstChild === leaf) {
    unnest(doc, leaf)
    return { leaf, offset: 0 }
  }
  if (item && !item.before) {
    liftFirstItem(doc, item)
    return { leaf, offset: 0 }
  }
  // DEL-11: a later item joins the item before it.
  if (item?.before) {
    const target = item.before
    for (const child of item.children) target.appendChild(child)
    doc.removeNode(item)
    return { leaf, offset: 0 }
  }
  // DEL-12: headings, definitions, front matter and one-line fences become paragraphs.
  if (
    leaf.type === 'heading' ||
    leaf.type === 'definition' ||
    leaf.type === 'frontmatter' ||
    ((leaf.type === 'fence' || leaf.type === 'html') && !leaf.text.includes('\n'))
  ) {
    becomeParagraph(leaf)
    return { leaf, offset: 0 }
  }
  if (leaf.isVerbatim()) return null

  // DEL-14: the document's first block.
  if (!previous) {
    if (leaf.text.length === 0 && leaf.nextLeaf()) {
      const next = leaf.nextLeaf()!
      doc.removeWithEmptyAncestors(leaf)
      return { leaf: next, offset: 0 }
    }
    return null
  }
  // DEL-13: merge into the previous leaf, or just go when empty.
  if (leaf.text.length === 0) {
    doc.removeWithEmptyAncestors(leaf)
    return { leaf: previous, offset: previous.text.length }
  }
  if (previous.type === 'table_cell') return { leaf: previous, offset: previous.text.length }
  const junction = previous.text.length
  previous.text += previous.isVerbatim() ? `\n${leaf.text}` : leaf.text
  doc.removeWithEmptyAncestors(leaf)
  return { leaf: previous, offset: junction }
}

/** Delete with the caret at the end of a leaf (DEL-15, DEL-16). Null when nothing applies. */
export function deleteAtEnd(doc: MarkdownDocument, leaf: Node): Landing | null {
  if (leaf.type === 'table_cell') {
    const following = nextCell(leaf) ?? leaf.parent?.parent?.nextLeaf() ?? null
    return following && following.type !== 'hr' ? { leaf: following, offset: 0 } : null
  }
  const next = leaf.nextLeaf()
  if (!next) return null
  if (leaf.text.length === 0 && leaf.type === 'paragraph') {
    doc.removeWithEmptyAncestors(leaf)
    return { leaf: next, offset: 0 }
  }
  if (next.type === 'hr') {
    doc.removeWithEmptyAncestors(next)
    return { leaf, offset: leaf.text.length }
  }
  if (next.type === 'table_cell' || next.isVerbatim() || leaf.isVerbatim()) return { leaf: next, offset: 0 }
  const junction = leaf.text.length
  leaf.text += next.text
  doc.removeWithEmptyAncestors(next)
  return { leaf, offset: junction }
}

/**
 * A selection spanning blocks (DEL-22, DEL-24): the first leaf keeps its text before the
 * selection and takes the last leaf's text after it; everything between goes.
 */
export function deleteAcross(
  doc: MarkdownDocument,
  start: Node,
  startOffset: number,
  end: Node,
  endOffset: number,
): Landing | null {
  const startTable = start.type === 'table_cell' ? start.parent?.parent : null
  const endTable = end.type === 'table_cell' ? end.parent?.parent : null
  if (startTable && startTable === endTable) {
    // DEL-23: inside one table only the cells are cleared.
    clearCells(start, startOffset, end, endOffset)
    return { leaf: start, offset: startOffset }
  }
  // The leaves strictly between the two ends go — a table wholly inside goes with them (DEL-24).
  const between: Node[] = []
  const fromLeaf = startTable ? startTable.lastLeaf() : start
  const toLeaf = endTable ? endTable.firstLeaf() : end
  for (let leaf = fromLeaf.nextLeaf(); leaf && leaf !== toLeaf; leaf = leaf.nextLeaf()) between.push(leaf)
  if (startTable) clearCellsFrom(start, startOffset)
  if (endTable) clearCellsUpTo(end, endOffset)
  for (const leaf of between) doc.removeWithEmptyAncestors(leaf)
  if (!startTable && !endTable) {
    start.text = start.text.slice(0, startOffset) + end.text.slice(endOffset)
    doc.removeWithEmptyAncestors(end)
  } else if (!startTable) {
    start.text = start.text.slice(0, startOffset)
  } else if (!endTable) {
    end.text = end.text.slice(endOffset)
  }
  return { leaf: start, offset: startOffset }
}

/** Widens a selection inside one block to the hidden markers it touches (DEL-21). */
export function widenSelection(text: string, start: number, end: number, context: LexContext = {}): [number, number] {
  let from = start
  let to = end
  const visit = (nodes: InlineNode[], base: number) => {
    let offset = base
    for (const node of nodes) {
      const length = sourceOf(node).length
      const nodeStart = offset
      const nodeEnd = offset + length
      let contentStart = -1
      let contentEnd = -1
      if (node.type === 'emphasis') {
        contentStart = nodeStart + node.delim.length
        contentEnd = nodeEnd - node.delim.length
        visit(node.children, contentStart)
      } else if (node.type === 'underline') {
        contentStart = nodeStart + node.open.length
        contentEnd = nodeEnd - node.close.length
        visit(node.children, contentStart)
      } else if (node.type === 'code') {
        contentStart = nodeStart + node.open.length + node.pre.length
        contentEnd = nodeEnd - node.close.length - node.post.length
      } else if (node.type === 'link') {
        contentStart = nodeStart + 1
        contentEnd = contentStart + node.children.reduce((sum, child) => sum + sourceOf(child).length, 0)
        visit(node.children, contentStart)
      } else if (node.type === 'image') {
        contentStart = nodeStart
        contentEnd = nodeEnd
      }
      // A construct whose whole content is selected goes with its markers.
      if (contentStart >= 0 && from <= contentStart && to >= contentEnd && from < to) {
        from = Math.min(from, nodeStart)
        to = Math.max(to, nodeEnd)
      }
      offset = nodeEnd
    }
  }
  visit(lexInline(text, context), 0)
  return [from, to]
}
