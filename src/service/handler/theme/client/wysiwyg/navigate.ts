/**
 * Caret movement the browser gets wrong under hidden syntax and islands (architecture §7.5):
 * where a caret is on screen, whether it sits on a block's first or last visual line, and where a
 * point lands inside a block. Pure DOM helpers; the editor decides what to do with them.
 */

import { leafElementAt, positionAt } from './bookmark.ts'

export interface CaretRect {
  left: number
  top: number
  bottom: number
  height: number
}

/** Where the caret is drawn: the focus end of the selection, or the block's box when it has no text. */
export function caretRect(node: globalThis.Node, offset: number, leaf: HTMLElement): CaretRect {
  const range = document.createRange()
  try {
    range.setStart(node, offset)
    range.collapse(true)
  } catch {
    return boxOf(leaf)
  }
  const rects = range.getClientRects()
  const rect = rects.length > 0 ? rects[0]! : range.getBoundingClientRect()
  if (rect.height > 0) return { left: rect.left, top: rect.top, bottom: rect.bottom, height: rect.height }
  return boxOf(leaf)
}

function boxOf(leaf: HTMLElement): CaretRect {
  const box = leaf.getBoundingClientRect()
  const lineHeight = Number.parseFloat(getComputedStyle(leaf).lineHeight) || box.height
  return { left: box.left, top: box.top, bottom: box.top + lineHeight, height: lineHeight }
}

/** Is the caret on the block's first (direction -1) or last (direction 1) visual line? */
export function onEdgeLine(caret: CaretRect, leaf: HTMLElement, direction: -1 | 1): boolean {
  const box = leaf.getBoundingClientRect()
  const style = getComputedStyle(leaf)
  const slack = caret.height / 2
  if (direction === -1) return caret.top - (box.top + Number.parseFloat(style.paddingTop)) < slack
  return box.bottom - Number.parseFloat(style.paddingBottom) - caret.bottom < slack
}

/** The DOM position under a point inside `leaf`, or its start/end when the point misses its text. */
export function positionFromPoint(
  leaf: HTMLElement,
  x: number,
  y: number,
  fallback: 'start' | 'end',
): [globalThis.Node, number] {
  const box = leaf.getBoundingClientRect()
  const px = Math.min(Math.max(x, box.left + 1), box.right - 1)
  const py = Math.min(Math.max(y, box.top + 1), box.bottom - 1)
  const range = document.caretRangeFromPoint(px, py)
  if (range && leafElementAt(range.startContainer) === leaf) return [range.startContainer, range.startOffset]
  return positionAt(leaf, fallback === 'start' ? 0 : (leaf.textContent?.length ?? 0))
}

/** The cell of a row whose box spans `x`, else the first or last cell. */
export function cellUnder(row: Element, x: number, fallback: 'first' | 'last'): HTMLElement | null {
  const cells = [...row.querySelectorAll<HTMLElement>('[data-type="table_cell"]')]
  const under = cells.find((cell) => {
    const box = cell.getBoundingClientRect()
    return x >= box.left && x <= box.right
  })
  return under ?? (fallback === 'first' ? (cells[0] ?? null) : (cells[cells.length - 1] ?? null))
}

/** The islands of a document — what the caret must not enter, but a mouse selection must cross (§7.6). */
export function islandsOf(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('[data-inline="image"], figure[data-type="table"], .atom')]
}
