import { useEffect, useState } from 'react'

/**
 * The rail beside a page — a document's Details, a day's — and how it
 * opens: a third column on a wide window, remembered across visits; an
 * overlay from the header on a narrow one, closed by Escape or by turning
 * the page. One rule for every rail, so the explorer and the day agree.
 */

const RAIL_KEY = 'sky-rail'
const NARROW = '(max-width: 1180px)'

/** Whether the window is too narrow for a third column — then the rail is an overlay. */
export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches)
  useEffect(() => {
    const query = window.matchMedia(NARROW)
    const update = () => setNarrow(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return narrow
}

/** The rail's wide-screen preference: shown unless closed once. */
function railRemembered(): boolean {
  try {
    return localStorage.getItem(RAIL_KEY) !== 'closed'
  } catch {
    return true
  }
}

export interface Rail {
  narrow: boolean
  open: boolean
  toggle: () => void
  /** Closes the overlay; on a wide window the column stays as chosen. */
  close: () => void
}

/**
 * The rail's state for one page. `resetKey` closes the overlay when it
 * changes — a new file, another day — so a narrow window never carries
 * one page's rail onto the next.
 */
export function useRail(resetKey: unknown): Rail {
  const narrow = useNarrow()
  const [wide, setWide] = useState(railRemembered)
  const [overlay, setOverlay] = useState(false)
  const open = narrow ? overlay : wide
  const toggle = () => {
    if (narrow) setOverlay((was) => !was)
    else {
      setWide((was) => {
        try {
          localStorage.setItem(RAIL_KEY, was ? 'closed' : 'open')
        } catch {
          // Then the choice lasts for this visit only.
        }
        return !was
      })
    }
  }
  const close = () => setOverlay(false)
  useEffect(() => {
    if (!narrow || !overlay) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOverlay(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [narrow, overlay])
  useEffect(() => {
    setOverlay(false)
  }, [resetKey])
  return { narrow, open, toggle, close }
}
