/**
 * Caret positions as character offsets inside a leaf block (architecture §7). The DOM under the
 * root changes shape on every repaint, so ranges are never kept; a bookmark counts characters of
 * the leaf's textContent — hidden syntax included — and converts back to a live position on demand.
 */

export interface Bookmark {
  blockId: string
  start: number
  end: number
}

/** Leaf blocks: the elements a caret can be in. */
export const LEAF_SELECTOR = '.end-block'

/**
 * The text nodes of a leaf in order, skipping chrome — controls rendered inside a block, marked
 * `data-chrome`, whose text is not the block's.
 */
export function textWalker(leaf: HTMLElement): TreeWalker {
  return document.createTreeWalker(leaf, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node instanceof Element)
        return node.hasAttribute('data-chrome') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP
      return NodeFilter.FILTER_ACCEPT
    },
  })
}

/** The block's text as its markdown: every text node in order, chrome left out. */
export function textOf(leaf: HTMLElement): string {
  const walker = textWalker(leaf)
  let text = ''
  for (let node = walker.nextNode(); node; node = walker.nextNode()) text += (node as Text).data
  return text
}

/** Is a DOM node inside a block's chrome rather than its text? */
export function inChrome(node: globalThis.Node | null | undefined): boolean {
  const element = node instanceof Element ? node : node?.parentElement
  return element?.closest('[data-chrome]') !== null && element?.closest('[data-chrome]') !== undefined
}

export function leafElementAt(node: globalThis.Node | null | undefined): HTMLElement | null {
  if (!node) return null
  const element = node instanceof Element ? node : node.parentElement
  return element?.closest<HTMLElement>(LEAF_SELECTOR) ?? null
}

export function elementFor(root: HTMLElement, id: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[data-node="${id}"]`)
}

/** Is `node` at or after `boundary` in document order? */
function atOrAfter(node: globalThis.Node, boundary: globalThis.Node): boolean {
  if (node === boundary || boundary.contains(node)) return true
  return (boundary.compareDocumentPosition(node) & globalThis.Node.DOCUMENT_POSITION_FOLLOWING) !== 0
}

/** The character offset of a DOM position inside a leaf, counting every text node in order. */
export function offsetIn(leaf: HTMLElement, container: globalThis.Node, offset: number): number {
  const walker = textWalker(leaf)
  let total = 0
  if (container.nodeType === globalThis.Node.TEXT_NODE) {
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      if (text === container) return total + offset
      total += (text as Text).length
    }
    return total
  }
  // An element position: before its child at `offset`, or at its end.
  const boundary = container.childNodes[offset] ?? null
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    if (boundary ? atOrAfter(text, boundary) : !container.contains(text) && atOrAfter(text, container)) break
    total += (text as Text).length
  }
  return total
}

/** The DOM position for a character offset; at a boundary between two text nodes, the earlier one. */
export function positionAt(leaf: HTMLElement, offset: number): [globalThis.Node, number] {
  const walker = textWalker(leaf)
  let total = 0
  let last: Text | null = null
  for (let text = walker.nextNode() as Text | null; text; text = walker.nextNode() as Text | null) {
    if (text.length === 0) continue
    if (offset <= total + text.length) return [text, offset - total]
    total += text.length
    last = text
  }
  if (last) return [last, last.length]
  // No text: the position before the block's first non-chrome child (its line box), after any chrome.
  const children = [...leaf.childNodes]
  const first = children.findIndex((child) => !(child instanceof Element && child.hasAttribute('data-chrome')))
  return [leaf, first === -1 ? children.length : first]
}

/** A range over a leaf's text only — chrome left out. */
export function rangeOverText(leaf: HTMLElement): Range {
  const range = document.createRange()
  const [startNode, startOffset] = positionAt(leaf, 0)
  const [endNode, endOffset] = positionAt(leaf, textOf(leaf).length)
  range.setStart(startNode, startOffset)
  range.setEnd(endNode, endOffset)
  return range
}

export function bookmarkFromSelection(root: HTMLElement): Bookmark | null {
  const selection = document.getSelection()
  if (!selection || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  const leaf = leafElementAt(range.startContainer)
  if (!leaf || !root.contains(leaf) || !leaf.dataset.node) return null
  const start = offsetIn(leaf, range.startContainer, range.startOffset)
  const endLeaf = leafElementAt(range.endContainer)
  const end = endLeaf === leaf ? offsetIn(leaf, range.endContainer, range.endOffset) : start
  return { blockId: leaf.dataset.node, start, end }
}

export function rangeFromBookmark(root: HTMLElement, bookmark: Bookmark): Range | null {
  const leaf = elementFor(root, bookmark.blockId)
  if (!leaf) return null
  const range = document.createRange()
  const [startNode, startOffset] = positionAt(leaf, bookmark.start)
  range.setStart(startNode, startOffset)
  const [endNode, endOffset] = positionAt(leaf, Math.max(bookmark.start, bookmark.end))
  range.setEnd(endNode, endOffset)
  return range
}

export function selectRange(range: Range) {
  const selection = document.getSelection()
  if (!selection) return
  selection.removeAllRanges()
  selection.addRange(range)
}

/** The leaf the selection starts in, when it is inside the root. */
export function selectedLeaf(root: HTMLElement): HTMLElement | null {
  const selection = document.getSelection()
  if (!selection || selection.rangeCount === 0) return null
  const leaf = leafElementAt(selection.getRangeAt(0).startContainer)
  return leaf && root.contains(leaf) ? leaf : null
}
