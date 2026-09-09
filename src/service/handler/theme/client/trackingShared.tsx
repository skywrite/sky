import { ActionIcon, Button } from '@mantine/core'
import type { MouseEvent, ReactNode } from 'react'
import type { Tracker } from '#lib/tracking/types.ts'
import type { TrackingActions } from './trackingData.ts'

const icons = {
  tracking: <path d="M4 4v16h17M7 14l4-5 4 3 5-8" />,
  moon: <path d="M20.8 14A9 9 0 0 1 10 3.2 9 9 0 1 0 20.8 14Z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  chevron: <path d="m9 5 7 7-7 7" />,
  check: <path d="m5 12 4 4L19 6" />,
  edit: <path d="m15 4 5 5-10 10-6 1 1-6L15 4ZM13 6l5 5" />,
  dots: (
    <>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </>
  ),
  chat: (
    <>
      <path d="M7 4h10a4 4 0 0 1 4 4v7a4 4 0 0 1-4 4H9l-5 3v-5a4 4 0 0 1-1-2V8a4 4 0 0 1 4-4Z" />
      <path d="M7 9h10M7 13h6" />
    </>
  ),
  download: <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 6v6l4 2" />
    </>
  ),
  number: <path d="M9 3 7 21M17 3l-2 18M4 9h17M3 16h17" />,
  text: <path d="M4 5h16M4 10h16M4 15h12M4 20h9" />,
  file: <path d="M5 3h9l5 5v13H5V3Zm9 0v6h5M8 13h8M8 17h6" />,
}

export function TrackingIcon({ name = 'tracking', className = '' }: { name?: keyof typeof icons; className?: string }) {
  return (
    <svg
      className={`sky-tracking-icon ${className}`}
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {icons[name]}
    </svg>
  )
}

export function TrackerSymbol({ tracker }: { tracker: Tracker }) {
  const type = tracker.columns.find((column) => column.type !== 'time' && column.name !== 'notes')?.type
  return (
    <span className="sky-tracking-symbol">
      <TrackingIcon
        name={
          type === 'duration' || type === 'range'
            ? 'clock'
            : type === 'number'
              ? 'number'
              : type === 'word' || type === 'text'
                ? 'text'
                : 'tracking'
        }
      />
    </span>
  )
}

export function TrackingLink({
  to,
  navigate,
  children,
  className,
  label,
}: {
  to: string
  navigate: (path: string) => void
  children: ReactNode
  className?: string
  label?: string
}) {
  const click = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    navigate(to)
  }
  return (
    <a href={to} onClick={click} className={className} aria-label={label}>
      {children}
    </a>
  )
}

export function TrackingFeedback({ actions }: { actions: TrackingActions }) {
  return (
    <>
      {actions.error && (
        <p className="sky-tracking-error" role="alert">
          {actions.error}
        </p>
      )}
      {actions.notice && (
        <div className="sky-tracking-toast" role="status">
          <span>{actions.notice.text}</span>
          {actions.notice.undo && (
            <Button size="compact-sm" variant="secondary" onClick={() => void actions.undo()} loading={actions.busy}>
              Undo
            </Button>
          )}
          <ActionIcon
            variant="secondary"
            size="sm"
            aria-label="Dismiss notification"
            onClick={() => actions.setNotice(null)}
          >
            ×
          </ActionIcon>
        </div>
      )}
    </>
  )
}

export const trackerHref = (name: string): string => `/tracking/${encodeURIComponent(name)}`
export const answerLabel = (name: string): string => name.replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase())
export const trackingPurpose = (markdown: string): string =>
  markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('#') && !line.startsWith('---'))
    ?.replace(/[*_`]/g, '') ?? ''
