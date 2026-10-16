import type { Page } from 'playwright'

// A scroll moves what a person would scroll with the pointer in the middle of
// the window: the page itself, or the panel there that scrolls on its own.
// A mouse wheel lands wherever the pointer last was, and after a click on a
// header that is the header: nothing moves, and a page whose content scrolls
// inside a panel can never be read further down. Scrolling from inside the
// page also says how far the content went and when it reached the end, and
// it moves a window that is not in front the same as one that is.

/** Below this size in view, a scrolling box is a widget, not the content. */
const MIN_PANEL_PX = 100
/** Overflow this small is rounding or a border, not content to scroll to. */
const MIN_OVERFLOW_PX = 8

type Found =
  | { kind: 'scrolled'; where: 'page' | 'panel'; moved: number; more: boolean }
  | { kind: 'end' }
  | { kind: 'frame' | 'none'; x: number; y: number }

export interface ScrollResult {
  text: string
  /** Nothing could move that way */
  isError: boolean
}

/** Runs inside the page: one self-contained function, nothing from this module. */
function scrollInPage({
  vertical,
  delta,
  min,
  slack,
}: {
  vertical: boolean
  delta: number
  min: number
  slack: number
}): Found {
  const width = innerWidth
  const height = innerHeight
  const root = document.scrollingElement ?? document.documentElement
  const parentOf = (node: Element): Element | null =>
    node.parentElement ?? (node.getRootNode() as ShadowRoot).host ?? null
  const deepest = (x: number, y: number): Element | null => {
    let hit = document.elementFromPoint(x, y)
    while (hit?.shadowRoot) {
      const inner = hit.shadowRoot.elementFromPoint(x, y)
      if (!inner || inner === hit) break
      hit = inner
    }
    return hit
  }
  const inside = (box: Element, node: Element | null): boolean => {
    for (let at = node; at; at = parentOf(at)) if (at === box) return true
    return false
  }
  const span = (box: Element) => (vertical ? box.scrollHeight - box.clientHeight : box.scrollWidth - box.clientWidth)
  const offset = (box: Element) => (vertical ? box.scrollTop : box.scrollLeft)
  const room = (box: Element) => (delta > 0 ? span(box) - offset(box) : offset(box))
  const overflow = (style: CSSStyleDeclaration) => (vertical ? style.overflowY : style.overflowX)
  const inView = (box: Element) => {
    const rect = box.getBoundingClientRect()
    const left = Math.max(rect.left, 0)
    const top = Math.max(rect.top, 0)
    const right = Math.min(rect.right, width)
    const bottom = Math.min(rect.bottom, height)
    return { w: right - left, h: bottom - top, x: (left + right) / 2, y: (top + bottom) / 2 }
  }
  /** Whether the person could scroll this box: the page unless its overflow is locked, a panel when it overflows on purpose. */
  const scrolls = (box: Element): boolean => {
    if (span(box) < slack) return false
    if (box === root) {
      // The root's overflow applies to the page; while it is visible, the body's is used.
      const own = overflow(getComputedStyle(document.documentElement))
      const used = own === 'visible' && document.body ? overflow(getComputedStyle(document.body)) : own
      return !/^(hidden|clip)$/.test(used)
    }
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(box.tagName)) return false
    if (!/^(auto|scroll|overlay)$/.test(overflow(getComputedStyle(box)))) return false
    const { w, h } = inView(box)
    return w >= min && h >= min
  }

  let scrollable = false
  const tried = new Set<Element>()
  const attempt = (box: Element): Found | undefined => {
    tried.add(box)
    if (!scrolls(box)) return
    scrollable = true
    if (room(box) < 1) return
    const before = offset(box)
    box.scrollBy(vertical ? { top: delta, behavior: 'instant' } : { left: delta, behavior: 'instant' })
    const moved = Math.abs(offset(box) - before)
    // A box that only looks scrollable, such as a body whose overflow belongs to the page, does not move.
    if (moved < 1) return
    return { kind: 'scrolled', where: box === root ? 'page' : 'panel', moved: Math.round(moved), more: room(box) >= 1 }
  }

  const middle = deepest(width / 2, height / 2)
  // An embedded frame's own page is out of reach from here; a wheel turn over it goes in.
  if (middle && /^(IFRAME|FRAME|EMBED|OBJECT)$/.test(middle.tagName))
    return { kind: 'frame', x: width / 2, y: height / 2 }
  // What a wheel in the middle of the window would scroll: the nearest box around that point that can still move.
  for (let box = middle; box; box = parentOf(box)) {
    const found = attempt(box)
    if (found) return found
  }
  if (!tried.has(root)) {
    const found = attempt(root)
    if (found) return found
  }
  // Nothing around the middle moves: the largest panel in view, not covered by anything, that can.
  const panels = [...document.querySelectorAll('*')]
    .filter((box) => !tried.has(box) && scrolls(box))
    .map((box) => ({ box, view: inView(box) }))
    .filter(({ box, view }) => inside(box, deepest(view.x, view.y)))
    .sort((a, b) => b.view.w * b.view.h - a.view.w * a.view.h)
  for (const { box } of panels) {
    const found = attempt(box)
    if (found) return found
  }
  return scrollable ? { kind: 'end' } : { kind: 'none', x: width / 2, y: height / 2 }
}

const EDGE = { down: 'the bottom', up: 'the top', right: 'the right edge', left: 'the left edge' } as const

/** Scroll the content in the middle of the window by the larger of the two distances. */
export async function scrollContent(page: Page, deltaX: number, deltaY: number): Promise<ScrollResult> {
  if (deltaX === 0 && deltaY === 0) return { text: 'Give a distance to scroll.', isError: true }
  const vertical = Math.abs(deltaY) >= Math.abs(deltaX)
  const delta = vertical ? deltaY : deltaX
  const direction = vertical ? (delta > 0 ? 'down' : 'up') : delta > 0 ? 'right' : 'left'
  const found = await page.evaluate(scrollInPage, { vertical, delta, min: MIN_PANEL_PX, slack: MIN_OVERFLOW_PX })
  switch (found.kind) {
    case 'scrolled': {
      const what = found.where === 'page' ? 'the page' : 'a panel'
      const moved = `Scrolled ${what} ${direction} ${found.moved} px`
      return { text: found.more ? `${moved}.` : `${moved}, to ${EDGE[direction]}.`, isError: false }
    }
    case 'end':
      return { text: `Nothing on the page scrolls further ${direction}.`, isError: true }
    default:
      // The page draws its own scrolling, or a frame holds the content: only a wheel turn there reaches it.
      await page.mouse.move(found.x, found.y)
      await page.mouse.wheel(vertical ? 0 : delta, vertical ? delta : 0)
      return {
        text:
          found.kind === 'frame'
            ? `Turned the mouse wheel ${direction} over the embedded frame in the middle of the window.`
            : `Nothing on the page scrolls by itself; turned the mouse wheel ${direction} in the middle of the window.`,
        isError: false,
      }
  }
}
