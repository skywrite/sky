/**
 * Enter (architecture §8.1): the block splits at the caret with inline pairs re-balanced, the
 * first half commits any previewed marker, and the second half becomes what the context asks
 * for — a paragraph, a heading of the same level, a new list item. Model only.
 */

import { type InlineNode, type LexContext, lexInline, sourceOf } from './lexer.ts'
import { cloneItem, renumberAfter, unnest } from './lists.ts'
import type { MarkdownDocument, Node } from './model.ts'
import { reparseBlock, splitTableRow } from './parser.ts'
import { replaceNode } from './structure.ts'

interface Pair {
  open: string
  close: string
  start: number
  end: number
}

/** Paired constructs with their source ranges, outer before inner. */
function collectPairs(nodes: InlineNode[], base: number, out: Pair[]) {
  let offset = base
  for (const node of nodes) {
    const length = sourceOf(node).length
    if (node.type === 'emphasis') {
      out.push({ open: node.delim, close: node.delim, start: offset, end: offset + length })
      collectPairs(node.children, offset + node.delim.length, out)
    } else if (node.type === 'underline') {
      out.push({ open: node.open, close: node.close, start: offset, end: offset + length })
      collectPairs(node.children, offset + node.open.length, out)
    } else if (node.type === 'code') {
      out.push({ open: node.open + node.pre, close: node.post + node.close, start: offset, end: offset + length })
    } else if (node.type === 'link') {
      collectPairs(node.children, offset + 1, out)
    }
    offset += length
  }
}

/**
 * Splits text at the caret; a pair cut by the split is closed in the first half and reopened in
 * the second (`**bo|ld**` → `**bo**`, `**ld**`). A pair with nothing of its content on one side
 * leaves no empty pair there.
 */
export function balancedSplit(text: string, caret: number, context: LexContext = {}): [string, string] {
  const pairs: Pair[] = []
  collectPairs(lexInline(text, context), 0, pairs)
  const cut = pairs.filter((pair) => pair.start < caret && caret < pair.end)
  let cutFrom = caret
  let cutTo = caret
  const closers: string[] = []
  const openers: string[] = []
  for (const pair of cut) {
    if (caret > pair.start + pair.open.length) closers.push(pair.close)
    else cutFrom = Math.min(cutFrom, pair.start)
    if (caret < pair.end - pair.close.length) openers.push(pair.open)
    else cutTo = Math.max(cutTo, pair.end)
  }
  return [text.slice(0, cutFrom) + closers.reverse().join(''), openers.reverse().join('') + text.slice(cutTo)]
}

export interface SplitResult {
  /** Where the caret goes: a leaf and an offset in it. */
  leaf: Node
  offset: number
}

/** ENT-4: a lone pipe row committed by Enter becomes a table with that header and one empty body row. */
function tableFromRow(doc: MarkdownDocument, line: string): Node | null {
  if (!/^\s*\|.*\|\s*$/.test(line) || line.includes('\n')) return null
  const cells = splitTableRow(line).cells
  if (cells.length < 2) return null
  const table = doc.createNode('table', { align: cells.map(() => null) })
  const header = doc.createNode('table_row', { header: true, pipeStart: true, pipeEnd: true })
  for (const cell of cells) header.appendChild(doc.createNode('table_cell', { text: cell.trim() }))
  const body = doc.createNode('table_row', { header: false, pipeStart: true, pipeEnd: true })
  for (const _ of cells) body.appendChild(doc.createNode('table_cell'))
  table.appendChild(header)
  table.appendChild(body)
  return table
}

/**
 * Splits `leaf` at `caret` per the behavior spec's Enter rules (ENT-1 … ENT-16). The model
 * changes; the caller re-renders the leaf's top-level range and places the caret as returned.
 */
export function splitBlock(doc: MarkdownDocument, leaf: Node, caret: number, context: LexContext): SplitResult {
  const text = leaf.text
  const parent = leaf.parent
  if (!parent) return { leaf, offset: caret }

  // An empty block nested in a quote or list leaves its container (ENT-14 … ENT-16).
  if (leaf.type === 'paragraph' && text.length === 0 && (parent.type === 'list_item' || parent.type === 'blockquote')) {
    unnest(doc, leaf)
    return { leaf, offset: 0 }
  }

  const [first, second] = leaf.isInline()
    ? balancedSplit(text, caret, context)
    : [text.slice(0, caret), text.slice(caret)]
  leaf.text = first

  // The second half: an empty paragraph, a block of the same kind, or a new item.
  let after: Node
  const item = parent.type === 'list_item' && parent.firstChild === leaf ? parent : null
  if (item) {
    const newItem = cloneItem(doc, item)
    after = doc.createNode('paragraph', { text: second, ahead: 0 })
    newItem.appendChild(after)
    for (let sibling = leaf.after; sibling;) {
      const next = sibling.after
      newItem.appendChild(sibling)
      sibling = next
    }
    item.addAfter(newItem)
    renumberAfter(newItem)
  } else if (leaf.type === 'heading' && first.length === 0) {
    // ENT-6: an empty paragraph above, the heading below.
    const depth = leaf.depth
    leaf.clearAttrs()
    leaf.type = 'paragraph'
    after = doc.createNode('heading', { text: second, depth })
    leaf.addAfter(after)
  } else if (leaf.type === 'heading' && second.length > 0) {
    after = doc.createNode('heading', { text: second, depth: leaf.depth })
    leaf.addAfter(after)
  } else {
    after = doc.createNode('paragraph', { text: second })
    leaf.addAfter(after)
  }

  // The first half commits: a previewed heading, fence, rule, definition or pipe row (ENT-4, ENT-5).
  if (leaf.type === 'paragraph' && first.length > 0) {
    if (first === '---' && parent.type === 'document' && !leaf.before) {
      // ENT-5: the document's first paragraph turns into front matter, the caret inside it.
      const frontmatter = doc.createNode('frontmatter', {
        text: '',
        pattern: '---',
        patternEnd: '---',
        empty: true,
        ahead: 0,
      })
      replaceNode(doc, leaf, [frontmatter])
      return { leaf: frontmatter, offset: 0 }
    }
    const table = tableFromRow(doc, first)
    const blocks = table ? [table] : reparseBlock(doc, leaf)
    if (blocks) {
      replaceNode(doc, leaf, blocks)
      const created = blocks[blocks.length - 1]!
      if (created.type === 'fence') return { leaf: created, offset: 0 }
      if (created.type === 'table') return { leaf: created.children[1]!.firstChild!, offset: 0 }
    }
  }
  return { leaf: after, offset: 0 }
}
