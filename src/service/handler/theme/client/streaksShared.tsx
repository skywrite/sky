import { Button } from '@mantine/core'
import type { MouseEvent, ReactNode } from 'react'
import type { StreakView } from '../../streaks/types.ts'
import type { StreaksActions } from './streaksData.ts'
export { fileHref as streakFileHref } from './explorer.tsx'

export function StreakIcon({
  name,
  size = 20,
}: {
  name: 'check' | 'plus' | 'right' | 'left' | 'more' | 'book' | 'close' | 'arrow'
  size?: number
}) {
  const paths = {
    check: <path d="m5 12 4 4 10-10" />,
    plus: <path d="M12 5v14M5 12h14" />,
    right: <path d="m9 5 7 7-7 7" />,
    left: <path d="m15 5-7 7 7 7" />,
    more: (
      <>
        <circle cx="5" cy="12" r="1" />
        <circle cx="12" cy="12" r="1" />
        <circle cx="19" cy="12" r="1" />
      </>
    ),
    book: (
      <>
        <path d="M4 3h13a2 2 0 0 1 2 2v16H6a3 3 0 0 1-3-3V5a2 2 0 0 1 1-2Z" />
        <path d="M3 17h16M7 7h8" />
      </>
    ),
    close: <path d="m6 6 12 12M18 6 6 18" />,
    arrow: <path d="M4 12h15m-5-5 5 5-5 5" />,
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  )
}

export function StreakLink({
  href,
  onNavigate,
  className,
  children,
}: {
  href: string
  onNavigate: (path: string) => void
  className?: string
  children: ReactNode
}) {
  const click = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    onNavigate(href)
  }
  return (
    <a href={href} className={className} onClick={click}>
      {children}
    </a>
  )
}

export function streakHref(streak: StreakView): string {
  return `/streaks/${encodeURIComponent(streak.name)}`
}

export function StreaksFeedback({
  actions,
  error,
  onRetry,
}: {
  actions: StreaksActions
  error?: string
  onRetry?: () => void
}) {
  return (
    <>
      {(actions.error || error) && (
        <div className="sky-streaks-error" role="alert">
          <p>{actions.error || error}</p>
          {onRetry && (
            <Button variant="secondary" size="compact-sm" onClick={onRetry}>
              Try again
            </Button>
          )}
        </div>
      )}
      {actions.notice && (
        <div className="sky-streaks-toast" role="status">
          <StreakIcon name="check" size={18} />
          <span>{actions.notice.message}</span>
          {actions.notice.undoId && (
            <button disabled={actions.busy} onClick={() => void actions.act('/undo', { id: actions.notice!.undoId })}>
              Undo
            </button>
          )}
          <button aria-label="Dismiss notification" onClick={() => actions.setNotice(null)}>
            <StreakIcon name="close" size={15} />
          </button>
        </div>
      )}
    </>
  )
}

export function StreakCheck({
  streak,
  date,
  today,
  disabled,
  onClick,
}: {
  streak: StreakView
  date: string
  today: string
  disabled: boolean
  onClick: () => void
}) {
  const done = streak.done.includes(date)
  return (
    <button
      className="sky-streaks-habit-check"
      data-done={done}
      disabled={disabled}
      aria-label={`${done ? 'Undo' : 'Complete'} ${streak.title} ${date === today ? 'today' : `on ${date}`}`}
      aria-pressed={done}
      onClick={onClick}
    >
      <span>{done ? <StreakIcon name="check" size={16} /> : null}</span>
    </button>
  )
}
