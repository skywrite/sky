import { type RefObject, type TouchEvent, useEffect, useRef, useState } from 'react'

/**
 * Swipe a row left to delete it — the phone's way, where a row has no
 * hover to show its ×. A short pull reveals a Delete button and holds it
 * there until the person taps it or touches anything else; a long pull
 * deletes on release. The gesture is horizontal only: a touch that moves
 * more up or down than sideways is the page's scroll and is left alone.
 * Mouse and pen never start one — they have the ×.
 */

/** How far the row slides to show Delete, in px */
export const REVEAL_PX = 88
/** Movement before a touch is judged a swipe or a scroll */
const DECIDE_PX = 8

export type SwipeRest = 'closed' | 'open' | 'delete'

/** Where a released row comes to rest, from how far it was pulled against its width. */
export function settleSwipe(offset: number, width: number): SwipeRest {
  const pulled = -offset
  if (pulled >= Math.min(240, Math.max(REVEAL_PX * 1.5, width * 0.55))) return 'delete'
  if (pulled >= REVEAL_PX / 2) return 'open'
  return 'closed'
}

/** How plainly the Delete word shows for a pull — nothing until the pane has room for it. */
export function revealOpacity(offset: number): number {
  return Math.max(0, Math.min(1, (-offset - REVEAL_PX / 2) / (REVEAL_PX / 2)))
}

export interface Swipe {
  /** The row's horizontal shift, in px, never above zero */
  offset: number
  /** A finger is on the row: the shift follows it without easing */
  dragging: boolean
  /** The Delete button is out */
  open: boolean
  /** Slide the row away and delete — the Delete button's tap */
  commit: () => void
  /** Back to rest */
  close: () => void
  ref: RefObject<HTMLDivElement | null>
  handlers: {
    onTouchStart: (event: TouchEvent) => void
    onTouchMove: (event: TouchEvent) => void
    onTouchEnd: () => void
    onTouchCancel: () => void
  }
}

interface Touch {
  x: number
  y: number
  /** Where the row stood when the finger landed */
  from: number
  axis: 'x' | 'y' | null
}

export function useSwipeToDelete(onDelete: () => void): Swipe {
  const ref = useRef<HTMLDivElement>(null)
  const [offset, setOffset] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [open, setOpen] = useState(false)
  const touch = useRef<Touch | null>(null)
  const shift = useRef(0)

  const moveTo = (px: number) => {
    shift.current = px
    setOffset(px)
  }
  const width = () => ref.current?.offsetWidth ?? 0

  const close = () => {
    setOpen(false)
    moveTo(0)
  }
  const commit = () => {
    setOpen(false)
    moveTo(-width())
    onDelete()
  }

  const onTouchStart = (event: TouchEvent) => {
    if (event.touches.length !== 1) return
    const finger = event.touches[0]
    touch.current = { x: finger.clientX, y: finger.clientY, from: open ? -REVEAL_PX : 0, axis: null }
  }
  const onTouchMove = (event: TouchEvent) => {
    const start = touch.current
    if (!start) return
    const finger = event.touches[0]
    const dx = finger.clientX - start.x
    const dy = finger.clientY - start.y
    if (!start.axis) {
      if (Math.abs(dx) < DECIDE_PX && Math.abs(dy) < DECIDE_PX) return
      start.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
      if (start.axis === 'x') setDragging(true)
    }
    if (start.axis !== 'x') return
    moveTo(Math.max(-width(), Math.min(0, start.from + dx)))
  }
  const onTouchEnd = () => {
    const start = touch.current
    touch.current = null
    if (!start || start.axis !== 'x') return
    setDragging(false)
    const rest = settleSwipe(shift.current, width())
    if (rest === 'delete') commit()
    else if (rest === 'open') {
      setOpen(true)
      moveTo(-REVEAL_PX)
    } else close()
  }

  // A touch anywhere else puts an open row back.
  useEffect(() => {
    if (!open) return
    const elsewhere = (event: globalThis.TouchEvent) => {
      if (!ref.current?.contains(event.target as Node)) close()
    }
    document.addEventListener('touchstart', elsewhere, { passive: true })
    return () => document.removeEventListener('touchstart', elsewhere)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return {
    offset,
    dragging,
    open,
    commit,
    close,
    ref,
    handlers: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: onTouchEnd },
  }
}
