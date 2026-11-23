import type { MouseEvent, ReactNode } from 'react'

/** A link to another page of the app: a plain click turns the page in place, any other opens it as a link does. */
export function FutureLink({
  to,
  navigate,
  children,
  className,
  current = false,
}: {
  to: string
  navigate: (to: string) => void
  children: ReactNode
  className?: string
  /** This link is the page being shown */
  current?: boolean
}) {
  const click = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    navigate(to)
  }
  return (
    <a href={to} onClick={click} className={className} aria-current={current ? 'page' : undefined}>
      {children}
    </a>
  )
}
