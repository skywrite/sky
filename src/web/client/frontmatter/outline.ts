/**
 * The document's outline, read from its headings in the DOM — the same in the reading view and
 * the editor — and which one the reader is in.
 */

import { type RefObject, useEffect, useState } from 'react'
import type { OutlineItem } from './Rail.tsx'

const HEADINGS = 'h1, h2, h3, h4'

export function useOutline(scrollRef: RefObject<HTMLElement | null>, deps: unknown[]): OutlineItem[] {
  const [items, setItems] = useState<OutlineItem[]>([])
  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    let timer: number | undefined
    const read = () => {
      const headings = [...scroller.querySelectorAll<HTMLElement>(`.sky-doc-body :is(${HEADINGS})`)]
      const top = scroller.getBoundingClientRect().top
      let currentIndex = -1
      headings.forEach((heading, index) => {
        if (heading.getBoundingClientRect().top - top <= 80) currentIndex = index
      })
      if (currentIndex === -1 && headings.length > 0) currentIndex = 0
      setItems(
        headings.map((heading, index) => ({
          level: Number(heading.tagName.slice(1)),
          text: heading.textContent?.trim() ?? '',
          current: index === currentIndex,
          go: () => heading.scrollIntoView({ block: 'start', behavior: 'smooth' }),
        })),
      )
    }
    const schedule = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(read, 250)
    }
    read()
    const observer = new MutationObserver(schedule)
    observer.observe(scroller, { childList: true, subtree: true, characterData: true })
    scroller.addEventListener('scroll', schedule, { passive: true })
    return () => {
      observer.disconnect()
      scroller.removeEventListener('scroll', schedule)
      window.clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps name what changes the document
  }, [scrollRef, ...deps])
  return items
}
