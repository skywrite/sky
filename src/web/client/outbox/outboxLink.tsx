import type { MouseEvent, ReactNode } from 'react'
import { outboxHref } from './outboxRoutes.ts'

/**
 * A link to an item's page. It is a real address — it copies, it opens in
 * a new tab — and a plain click turns the page in place.
 */

/** The click handler an item link needs: modified clicks keep the browser's meaning, a plain one opens in place. */
export function outboxLinkClick(open: (id: string) => void, id: string) {
  return (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0) return
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    open(id)
  }
}

export function OutboxLink({
  id,
  open,
  className,
  children,
}: {
  id: string
  open: (id: string) => void
  className?: string
  children: ReactNode
}) {
  return (
    <a className={className} href={outboxHref(id)} onClick={outboxLinkClick(open, id)}>
      {children}
    </a>
  )
}
