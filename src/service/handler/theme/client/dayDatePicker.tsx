import './dayOrganizing.css'
import { ActionIcon, Button, Drawer, Modal } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { useRef, useState } from 'react'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
export function dayDateLabel(ymd: string): string {
  const day = new PlainDate(ymd)
  return `${day.dayShort}, ${MONTHS[day.month - 1].slice(0, 3)} ${day.day}, ${day.year}`
}
export function DayCalendarIcon() {
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M7 3v4m10-4v4M3 11h18M8 15h2m4 0h2" />
    </svg>
  )
}

export function DayDatePicker({
  today,
  initial,
  exclude,
  title,
  confirmLabel,
  busy = false,
  error,
  onClose,
  onChoose,
}: {
  today: string
  initial: string
  exclude?: string
  title: string
  confirmLabel: string
  busy?: boolean
  error?: string | null
  onClose: () => void
  onChoose: (ymd: string) => void
}) {
  const mobile = useMediaQuery('(max-width: 900px)') ?? false
  const tomorrow = new PlainDate(today).addDays(1).ymd
  const nextMonday = new PlainDate(today).addDays(8 - new PlainDate(today).dayOfWeek).ymd
  const firstChoice =
    initial >= today && initial !== exclude
      ? initial
      : tomorrow === exclude
        ? new PlainDate(tomorrow).addDays(1).ymd
        : tomorrow
  const [selected, setSelected] = useState(firstChoice)
  const [month, setMonth] = useState(firstChoice.slice(0, 7))
  const grid = useRef<HTMLDivElement>(null)
  const first = new PlainDate(`${month}-01`)
  const previous = first.addDays(-1).ymd.slice(0, 7)
  const next = first.addDays(first.daysInMonth).ymd.slice(0, 7)
  const pick = (ymd: string) => {
    setSelected(ymd)
    setMonth(ymd.slice(0, 7))
  }
  const common = {
    opened: true,
    title,
    onClose,
    padding: 0,
    closeOnEscape: !busy,
    closeOnClickOutside: !busy,
    withCloseButton: !busy,
    closeButtonProps: { 'aria-label': 'Close date picker' },
    zIndex: 230,
    classNames: { content: 'sky-date-dialog', body: 'sky-date-dialog-body' },
  }
  const body = (
    <>
      <div className="sky-date-body">
        <p className="sky-date-intro">Choose when you want to pick this up.</p>
        <div className="sky-date-shortcuts">
          {[
            { date: tomorrow, label: 'Tomorrow' },
            { date: nextMonday, label: 'Next Monday' },
          ].map(({ date, label }) => (
            <Button
              key={label}
              variant="secondary"
              disabled={busy || date === exclude}
              data-selected={selected === date}
              onClick={() => pick(date)}
            >
              {label}
            </Button>
          ))}
        </div>
        <div className="sky-date-month">
          <strong aria-live="polite">
            {MONTHS[first.month - 1]} {first.year}
          </strong>
          <div>
            <ActionIcon
              aria-label="Previous month"
              disabled={busy || previous < today.slice(0, 7)}
              onClick={() => setMonth(previous)}
            >
              ‹
            </ActionIcon>
            <ActionIcon
              aria-label="Next month"
              disabled={busy || (first.year >= 9999 && first.month === 12)}
              onClick={() => setMonth(next)}
            >
              ›
            </ActionIcon>
          </div>
        </div>
        <div
          className="sky-date-calendar"
          ref={grid}
          aria-label="Choose a date"
          onKeyDown={(event) => {
            const date = (event.target as HTMLElement).dataset.date
            if (!date || busy) return
            const current = new PlainDate(date)
            const offsets: Record<string, number> = {
              ArrowLeft: -1,
              ArrowRight: 1,
              ArrowUp: -7,
              ArrowDown: 7,
              Home: 1 - current.dayOfWeek,
              End: 7 - current.dayOfWeek,
            }
            if (!(event.key in offsets)) return
            event.preventDefault()
            const destination = current.addDays(offsets[event.key])
            if (destination.ymd < today || destination.ymd === exclude) return
            setMonth(destination.ymd.slice(0, 7))
            requestAnimationFrame(() =>
              grid.current?.querySelector<HTMLButtonElement>(`[data-date="${destination.ymd}"]`)?.focus(),
            )
          }}
        >
          {WEEKDAYS.map((day) => (
            <span className="sky-date-weekday" key={day}>
              {day}
            </span>
          ))}
          {Array.from({ length: first.dayOfWeek - 1 }, (_, i) => (
            <span key={`empty-${i}`} />
          ))}
          {Array.from({ length: first.daysInMonth }, (_, i) => {
            const date = first.addDays(i).ymd
            return (
              <button
                key={date}
                type="button"
                data-date={date}
                data-selected={date === selected}
                data-today={date === today}
                aria-label={dayDateLabel(date)}
                aria-pressed={date === selected}
                disabled={busy || date < today || date === exclude}
                onClick={() => setSelected(date)}
              >
                {i + 1}
              </button>
            )
          })}
        </div>
        <div className="sky-date-summary">
          <DayCalendarIcon />
          <div>
            {dayDateLabel(selected)}
            <small>Existing times and notes stay with each item.</small>
          </div>
        </div>
        {error && (
          <p className="sky-plan-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="sky-dialog-footer sky-date-footer">
        <Button variant="secondary" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" loading={busy} onClick={() => onChoose(selected)}>
          {confirmLabel}
        </Button>
      </div>
    </>
  )
  return mobile ? (
    <Drawer {...common} position="bottom" size="auto">
      {body}
    </Drawer>
  ) : (
    <Modal {...common} size={470} centered>
      {body}
    </Modal>
  )
}
