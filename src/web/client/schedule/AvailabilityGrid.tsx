import { Button, Popover, Tooltip } from '@mantine/core'
import { type CSSProperties, useMemo, useState } from 'react'
import { rangeKey } from '#lib/calendarScheduler/availabilityMessage.ts'
import type { AvailabilityDay, TimeRange } from '#lib/calendarScheduler/findTime.ts'
import { type CalendarEventEntry, minimumBlockMinutes, timeGrid } from './timeGrid.ts'
import './AvailabilityGrid.css'

function EventCard({
  event,
  toggleEvent,
  updating,
}: {
  event: CalendarEventEntry
  toggleEvent: (id: string) => void
  updating: boolean
}) {
  const [opened, setOpened] = useState(false)
  const ignored = event.kind === 'ignored'
  if (event.kind === 'nonblocking')
    return (
      <Tooltip
        label={`${event.title} · ${event.label} · Shows as free`}
        multiline
        maw={320}
        withArrow
        openDelay={200}
        events={{ hover: true, focus: true, touch: true }}
      >
        <div
          className="sky-find-event"
          data-kind={event.kind}
          role="group"
          aria-label="Calendar event marked free"
          tabIndex={0}
        >
          <h4>{event.title}</h4>
          <small>{event.label} · Shows as free</small>
        </div>
      </Tooltip>
    )
  return (
    <div
      className="sky-find-event"
      data-kind={event.kind}
      role="group"
      aria-label={ignored ? 'Ignored calendar event' : 'Busy calendar event'}
    >
      <h4>{event.title}</h4>
      <small>
        {ignored && 'Ignored · '}
        {event.label}
      </small>
      <Popover
        opened={opened}
        onChange={setOpened}
        position="bottom-start"
        width="min(300px, calc(100vw - 32px))"
        shadow="sm"
        trapFocus
        returnFocus
      >
        <Popover.Target>
          <button
            className="sky-find-event-target"
            type="button"
            aria-label={`Review ${event.title}, ${event.label}`}
            title={`${event.title} · ${event.label}`}
            onClick={() => setOpened(!opened)}
          />
        </Popover.Target>
        <Popover.Dropdown className="sky-find-event-details">
          <strong>{event.title}</strong>
          <span>
            {event.label} · {ignored ? 'Ignored for availability' : 'Counts as busy'}
          </span>
          <span>{event.calendarLabels.join(', ')}</span>
          <Button
            variant="default"
            size="compact-sm"
            disabled={updating}
            onClick={() => {
              setOpened(false)
              toggleEvent(event.id)
            }}
          >
            {ignored ? 'Count as busy' : 'Ignore this occurrence'}
          </Button>
        </Popover.Dropdown>
      </Popover>
    </div>
  )
}

export function AvailabilityGrid({
  days,
  selection,
  toggle,
  retry,
  toggleEvent,
  updating,
}: {
  days: AvailabilityDay[]
  selection: ReadonlySet<string> | null
  toggle: (range: TimeRange) => void
  retry: () => void
  toggleEvent: (id: string) => void
  updating: boolean
}) {
  const { columns, hours, firstHour, hourCount, hasAllDay } = useMemo(() => timeGrid(days), [days])
  const gridStyle = { '--sky-grid-days': columns.length, '--sky-grid-hours': hourCount } as CSSProperties
  return (
    <div
      className="sky-find-grid-scroll"
      role="region"
      aria-label="Calendar time grid"
      aria-busy={updating}
      tabIndex={0}
    >
      <div className="sky-find-days" style={gridStyle}>
        <div className="sky-grid-axis" aria-hidden="true">
          {hasAllDay && <div className="sky-grid-all-day">All day</div>}
          {hourCount > 0 && (
            <div className="sky-grid-track">
              {hours.map((hour) => (
                <span
                  key={hour}
                  className="sky-grid-hour"
                  data-hour={hour}
                  style={{ top: `${((hour - firstHour) / hourCount) * 100}%` }}
                >
                  {hour % 12 || 12} {hour % 24 < 12 ? 'am' : 'pm'}
                </span>
              ))}
            </div>
          )}
        </div>
        {columns.map(({ day, allDay, blocks }) => (
          <section className="sky-find-day" key={day.date} aria-label={day.label}>
            <header className="sky-grid-heading">
              <h3>{day.label}</h3>
              {day.warnings.length ? (
                <p className="sky-find-warning">
                  {day.warnings.join(' ')}{' '}
                  <Button size="compact-xs" onClick={retry}>
                    Check again
                  </Button>
                </p>
              ) : (
                !day.entries.some((entry) => entry.kind === 'free') && (
                  <p className="sky-find-hint">No openings in these hours.</p>
                )
              )}
            </header>
            {hasAllDay && (
              <div className="sky-grid-all-day">
                {allDay.map((event) => (
                  <EventCard key={event.id} event={event} toggleEvent={toggleEvent} updating={updating} />
                ))}
              </div>
            )}
            {hourCount > 0 && (
              <div className="sky-grid-track">
                {blocks.map(({ entry, startMinute, endMinute, lane, laneCount }) => {
                  const key = entry.kind === 'free' ? rangeKey(entry) : entry.id
                  const included = selection === null || selection.has(key)
                  return (
                    <div
                      key={`${entry.kind === 'free' ? 'opening' : 'event'}/${key}/${startMinute}`}
                      className="sky-grid-slot"
                      data-compact={endMinute - startMinute < 30 || undefined}
                      style={{
                        top: `${((startMinute / 60 - firstHour) / hourCount) * 100}%`,
                        height: `${(Math.max(endMinute - startMinute, minimumBlockMinutes) / (hourCount * 60)) * 100}%`,
                        insetInlineStart: `${(lane / laneCount) * 100}%`,
                        width: `${100 / laneCount}%`,
                      }}
                    >
                      {entry.kind !== 'free' ? (
                        <EventCard event={entry} toggleEvent={toggleEvent} updating={updating} />
                      ) : (
                        <button
                          type="button"
                          className="sky-find-opening"
                          aria-label={entry.label}
                          aria-pressed={included}
                          disabled={updating}
                          aria-description={included ? 'Proposed in your email' : 'Not proposed in your email'}
                          title={entry.label}
                          onClick={() => toggle(entry)}
                        >
                          <strong>{entry.label}</strong>
                          <small>{included ? 'Proposed' : 'Not proposed'}</small>
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  )
}
