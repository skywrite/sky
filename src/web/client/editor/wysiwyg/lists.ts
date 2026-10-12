/**
 * Lists and quotes on the model (architecture §8.3, §12.7): a block un-nested out of its container,
 * an item indented under the one before it, an item outdented to its parent list or into
 * paragraphs. Model only — the caller re-renders the touched range.
 */

import type { MarkdownDocument, Node } from './model.ts'

/** A list shaped like `list`, for the half split off it. */
function cloneList(doc: MarkdownDocument, list: Node, first: Node | null): Node {
  const clone = doc.createNode('list', {
    style: list.style ?? 'ul',
    loose: list.loose ?? false,
  })
  if (list.style === 'ol') {
    clone.delimiter = list.delimiter ?? '.'
    const number = first?.markerText ? Number.parseInt(first.markerText, 10) : Number.NaN
    clone.start = Number.isFinite(number) ? number : (list.start ?? 1) + (first?.index ?? 0)
    if (list.isFixed) clone.isFixed = true
  } else {
    clone.bullet = list.bullet ?? '-'
  }
  return clone
}

/** An item shaped like `item` for the same list, unchecked when it was a task, with no recorded prefixes. */
export function cloneItem(doc: MarkdownDocument, item: Node): Node {
  return doc.createNode('list_item', {
    checked: item.checked == null ? null : false,
    prespace: item.prespace ?? '',
    markerSpacing: item.markerSpacing ?? ' ',
    subindent: item.subindent,
    ahead: item.ahead === undefined ? undefined : 0,
  })
}

/** The siblings after `node`, in order. */
function siblingsAfter(node: Node): Node[] {
  const out: Node[] = []
  for (let next = node.after; next; next = next.after) out.push(next)
  return out
}

/** Items after `item` lose their recorded numbers, so a numbered list counts on from the change (LST-1). */
export function renumberAfter(item: Node) {
  for (let next = item.after; next; next = next.after) next.markerText = undefined
}

/** Moves nodes into `container`, in order; a node that lands first in it has no blank lines before it. */
function moveInto(nodes: Node[], container: Node): number {
  for (const node of nodes) container.appendChild(node)
  const first = nodes[0]
  if (first && !first.before) {
    first.ahead = 0
    first.aheadLines = undefined
  }
  return nodes.length
}

/**
 * Un-nesting (§8.3): the block leaves its container, becoming a sibling of the container's two
 * halves one level up — a new item when that level is a list. Empty halves go. The block is
 * returned still attached, at its new place.
 */
export function unnest(doc: MarkdownDocument, block: Node): Node {
  const parent = block.parent
  if (!parent) return block
  if (parent.type === 'blockquote') {
    const trailing = doc.createNode('blockquote')
    const following = siblingsAfter(block)
    block.detach()
    const moved = moveInto(following, trailing)
    parent.addAfter(block)
    if (moved > 0) block.addAfter(trailing)
    else doc.removeNode(trailing)
    if (!parent.firstChild) doc.removeNode(parent)
    block.ahead = undefined
    return block
  }
  if (parent.type !== 'list_item' || !parent.parent) return block
  const list = parent.parent
  if (parent.childCount === 1) {
    // The whole item leaves the list: the block lands after the list's first half.
    const trailingList = cloneList(doc, list, parent.after)
    const followingItems = siblingsAfter(parent)
    block.detach()
    moveInto(followingItems, trailingList)
    doc.removeNode(parent)
    list.addAfter(block)
    if (trailingList.firstChild) block.addAfter(trailingList)
    else doc.removeNode(trailingList)
    if (!list.firstChild) {
      block.ahead = list.ahead
      doc.removeNode(list)
    } else {
      block.ahead = undefined
    }
    return block
  }
  // The block is one of the item's blocks: it becomes an item of its own right after the item,
  // which keeps its other blocks.
  const item = cloneItem(doc, parent)
  block.detach()
  item.appendChild(block)
  parent.addAfter(item)
  renumberAfter(item)
  if (!parent.firstChild) doc.removeNode(parent)
  block.ahead = 0
  return block
}

/** The item's blocks leave the list, landing before it (DEL-10 for a list's first item). */
export function liftFirstItem(doc: MarkdownDocument, item: Node) {
  const list = item.parent
  if (!list) return
  const children = item.children
  let anchor: Node | null = null
  for (const child of children) {
    if (anchor) anchor.addAfter(child)
    else list.addBefore(child)
    anchor = child
  }
  if (children[0]) children[0].ahead = list.ahead
  doc.removeNode(item)
  if (!list.firstChild) doc.removeNode(list)
  else list.ahead = undefined
}

/** Tab (TAB-1): the item nests under the item before it, joining that item's trailing list of the same kind. */
export function indentItem(doc: MarkdownDocument, item: Node): boolean {
  const list = item.parent
  const previous = item.before
  if (!list || !previous) return false
  const last = previous.lastChild
  const sameKind =
    last?.type === 'list' &&
    last.style === list.style &&
    (list.style === 'ul' ? last.bullet === list.bullet : last.delimiter === list.delimiter)
  const target = sameKind && last ? last : previous.appendChild(cloneList(doc, list, null))
  if (!sameKind) {
    target.start = 1
    target.ahead = 0
  }
  item.markerText = undefined
  item.userIndent = undefined
  item.ahead = list.loose ? undefined : 0
  target.appendChild(item)
  return true
}

/**
 * Shift+Tab (TAB-3): a nested item moves after its parent item, the items that followed it
 * becoming its children; a top-level item becomes paragraphs between the list's halves.
 */
export function outdentItem(doc: MarkdownDocument, item: Node): boolean {
  const list = item.parent
  if (!list || !list.parent) return false
  const grandItem = list.parent
  const trailing = cloneList(doc, list, item.after)
  const followingItems = siblingsAfter(item)
  if (grandItem.type === 'list_item') {
    moveInto(followingItems, trailing)
    item.detach()
    grandItem.addAfter(item)
    if (trailing.firstChild) {
      trailing.ahead = 0
      item.appendChild(trailing)
    } else doc.removeNode(trailing)
    item.markerText = undefined
    item.userIndent = undefined
    if (!list.firstChild) doc.removeNode(list)
    return true
  }
  moveInto(followingItems, trailing)
  const children = item.children
  let anchor: Node = list
  for (const child of children) {
    anchor.addAfter(child)
    anchor = child
    child.ahead = undefined
    child.aheadLines = undefined
  }
  if (trailing.firstChild) anchor.addAfter(trailing)
  else doc.removeNode(trailing)
  doc.removeNode(item)
  if (!list.firstChild) doc.removeNode(list)
  return true
}
