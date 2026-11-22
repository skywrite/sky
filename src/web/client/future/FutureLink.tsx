import type { MouseEvent, ReactNode } from 'react'

/** A link to another page of the app: a plain click turns the page in place, any other opens it as a link does. */
export function FutureLink({
  to,
  navigate,
  children,
  className,
}: {
  to: string
  navigate: (to: string) => void
  children: ReactNode
  className?: string
}) {
  const click = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    navigate(to)
  }
  return (
    <a href={to} onClick={click} className={className}>
      {children}
    </a>
  )
}
