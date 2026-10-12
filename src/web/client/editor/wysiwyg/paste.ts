/**
 * Pasting on the model (architecture §13.1): a single line goes into the block's text; several
 * lines become real blocks, the first line joining the paragraph at the caret and the text that
 * followed the caret re-attached after the last pasted block. Model only.
 */

import { cloneItem, renumberAfter } from './lists.ts'
import type { MarkdownDocument, Node } from './model.ts'
import { parseLines } from './parser.ts'

export interface Landing {
  leaf: Node
  offset: number
}

/** Inserts text at a caret in a leaf — literally for verbatim blocks and cells, as markdown otherwise. */
export function pasteText(doc: MarkdownDocument, leaf: Node, caret: number, text: string, literal = false): Landing {
  const normalized = text.replaceAll('\r\n', '\n')
  if (leaf.type === 'table_cell') {
    // A cell holds one line (CLP-9): breaks become <br>.
    const cellText = normalized.replace(/\n/g, '<br>')
    leaf.text = leaf.text.slice(0, caret) + cellText + leaf.text.slice(caret)
    if (leaf.parent?.parent) leaf.parent.parent.userText = undefined
    return { leaf, offset: caret + cellText.length }
  }
  if (literal || leaf.isVerbatim() || !normalized.includes('\n') || leaf.type === 'heading') {
    // Verbatim blocks take anything as it is (CLP-10); a heading keeps its one line (CLP-9).
    const insert = leaf.type === 'heading' ? normalized.split('\n')[0]! : normalized
    leaf.text = leaf.text.slice(0, caret) + insert + leaf.text.slice(caret)
    return { leaf, offset: caret + insert.length }
  }
  return pasteBlocks(doc, leaf, caret, normalized)
}

/** Several lines of markdown into a paragraph: real blocks (CLP-8), spliced into a list when inside one (CLP-11). */
function pasteBlocks(doc: MarkdownDocument, leaf: Node, caret: number, markdown: string): Landing {
  const parsed = parseLines(doc, markdown.split('\n'), { indentedCode: false })
  const nodes = parsed.nodes
  if (nodes.length === 0) return { leaf, offset: caret }
  const before = leaf.text.slice(0, caret)
  const after = leaf.text.slice(caret)
  leaf.text = before

  // The first pasted paragraph joins the caret's block.
  let landing: Landing | null = null
  const first = nodes[0]!
  if (first.type === 'paragraph') {
    leaf.text = before + first.text
    landing = { leaf, offset: leaf.text.length }
    doc.removeNode(nodes.shift()!)
  }
  if (nodes.length > 0) {
    for (const node of nodes) node.ahead = undefined
    const item = leaf.parent?.type === 'list_item' && leaf.parent.firstChild === leaf ? leaf.parent : null
    if (item) spliceIntoList(doc, item, nodes)
    else {
      let anchor = leaf
      for (const node of nodes) {
        anchor.addAfter(node)
        anchor = node
      }
    }
    const lastLeaf = nodes[nodes.length - 1]!.lastLeaf()
    landing =
      lastLeaf.type === 'hr' ? { leaf, offset: leaf.text.length } : { leaf: lastLeaf, offset: lastLeaf.text.length }
    // An empty paragraph that only held the caret gives way to the pasted blocks.
    if (leaf.text.length === 0 && after.length === 0 && !item && leaf.type === 'paragraph') {
      if (nodes[0]) nodes[0].ahead = leaf.ahead
      doc.removeNode(leaf)
      if (landing.leaf === leaf) landing = { leaf: nodes[0]!.firstLeaf(), offset: 0 }
    }
  }
  // What followed the caret comes after the pasted content.
  if (after.length > 0) {
    const tail = landing?.leaf ?? leaf
    if (tail.isInline()) tail.text += after
    else {
      const paragraph = doc.createNode('paragraph', { text: after })
      ;(tail.topLevel() ?? tail).addAfter(paragraph)
    }
  }
  return landing ?? { leaf, offset: caret }
}

/** Blocks pasted into an item: lists contribute their items after it, anything else becomes an item (CLP-11). */
function spliceIntoList(doc: MarkdownDocument, item: Node, nodes: Node[]) {
  let anchor = item
  for (const node of nodes) {
    if (node.type === 'list') {
      for (const child of node.children) {
        child.markerText = undefined
        child.userIndent = undefined
        anchor.addAfter(child)
        anchor = child
      }
      doc.removeNode(node)
      continue
    }
    const holder = cloneItem(doc, item)
    holder.checked = null
    holder.appendChild(node)
    node.ahead = 0
    anchor.addAfter(holder)
    anchor = holder
  }
  renumberAfter(item)
}
