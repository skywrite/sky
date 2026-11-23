import { Alert, Button, Textarea } from '@mantine/core'
import { useEffect, useState } from 'react'
import { startMinutePhrase } from '#lib/calendarScheduler/availabilityMessage.ts'
import type { CalendarSetup } from '#lib/calendarScheduler/types.ts'
import { meetingRequest } from '../meetings/meetingRequest.ts'
import { AvailabilityGrid } from './AvailabilityGrid.tsx'
import { CalendarPicker } from './CalendarPicker.tsx'
import { MessagePreview } from './MessagePreview.tsx'
import { SearchControls } from './SearchControls.tsx'
import { useAvailabilityFilters } from './useAvailabilityFilters.ts'
import { useAvailabilitySearch } from './useAvailabilitySearch.ts'
import { useProposedRanges } from './useProposedRanges.ts'
import { zoneLabel } from './zones.ts'

export function FindTime({
  active,
  query,
  setQuery,
}: {
  active: boolean
  query: string
  setQuery: (text: string) => void
}) {
  const [setup, setSetup] = useState<CalendarSetup | null>(null)
  const [setupError, setSetupError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const text = query.trim()
  const connected = !!setup?.accounts.length
  const { disabledCalendars, ignoredEvents, toggleCalendar, toggleEvent } = useAvailabilityFilters()
  const { search, days, calendars, updatingFilters, change, retry, error } = useAvailabilitySearch(
    active,
    text,
    connected ? setup?.timezone : undefined,
    disabledCalendars,
    ignoredEvents,
  )
  const proposals = useProposedRanges(text, days, updatingFilters)
  useEffect(() => {
    if (!active) return
    document.title = 'sky · Find a time'
    const controller = new AbortController()
    setSetupError('')
    void meetingRequest<CalendarSetup>('setup', undefined, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setSetup(value)
      })
      .catch((failure: Error) => {
        if (!controller.signal.aborted) {
          setSetup(null)
          setSetupError(failure.message)
        }
      })
    return () => controller.abort()
  }, [active, attempt])

  return (
    <div className="sky-find-time">
      <Textarea
        aria-label="Describe the availability you want to share"
        placeholder="Find openings Monday through Wednesday afternoon, with a 15-minute buffer. Show times in Pacific."
        autosize
        minRows={2}
        maxRows={6}
        maxLength={4000}
        value={query}
        autoFocus={active}
        onChange={(event) => setQuery(event.currentTarget.value)}
      />
      {setupError ? (
        <Alert color="red" role="alert">
          {setupError}{' '}
          <Button size="compact-sm" onClick={() => setAttempt(attempt + 1)}>
            Retry connection
          </Button>
        </Alert>
      ) : setup && !connected ? (
        <Alert color="yellow">
          Connect a Google calendar to find your open times.{' '}
          <a href="/settings/connections/google">Connect Google Calendar</a>
        </Alert>
      ) : !query.trim() ? (
        <p className="sky-find-hint">
          Describe the days and hours you want to offer. Select the openings to include in your email.
        </p>
      ) : null}
      {search && (
        <SearchControls
          search={search}
          change={(update) => {
            if (update.startMinutes || (update.displayTimezone && search.startMinutes?.length))
              proposals.beforeFilterChange()
            else if (!update.displayTimezone) proposals.reset()
            change(update)
          }}
        />
      )}
      {error && (
        <Alert color="red" role="alert">
          {error}{' '}
          <Button size="compact-sm" onClick={retry}>
            Retry
          </Button>
        </Alert>
      )}
      {connected && query.trim() && !days && !error && (
        <p role="status" className="sky-find-hint">
          {search ? 'Checking your calendars…' : 'Reading your request…'}
        </p>
      )}
      {connected && search && (days || calendars.length > 0) && (
        <section aria-label="Your availability">
          <div className="sky-find-section-head">
            <h2>Your availability</h2>
            <div className="sky-find-calendar-controls">
              {calendars.length > 0 && (
                <CalendarPicker
                  calendars={calendars}
                  disabled={disabledCalendars}
                  toggle={(id) => {
                    proposals.beforeFilterChange()
                    toggleCalendar(id)
                  }}
                />
              )}
              <span>
                {zoneLabel(search.displayTimezone)} time
                {!!search.startMinutes?.length && (
                  <small className="sky-find-start-rule">Starts {startMinutePhrase(search.startMinutes)}</small>
                )}
              </span>
            </div>
          </div>
          {days && (
            <>
              <div className="sky-find-guide">
                <ul className="sky-find-legend" aria-label="Calendar colors">
                  <li data-state="busy">Busy</li>
                  <li data-state="proposed">Proposed</li>
                  <li data-state="neutral">Not proposed</li>
                </ul>
                {updatingFilters ? (
                  <p role="status">Updating openings…</p>
                ) : calendars.length > 0 &&
                  calendars.every(({ id }) => disabledCalendars.includes(id)) &&
                  days.every((day) => !day.warnings.length) ? (
                  <p>All calendars are off. Showing your requested hours.</p>
                ) : (
                  <p>Click a meeting to change whether it counts. Click an opening to update your email.</p>
                )}
              </div>
              <AvailabilityGrid
                days={days}
                selection={proposals.selection}
                toggle={proposals.toggle}
                retry={retry}
                toggleEvent={(id) => {
                  proposals.beforeFilterChange()
                  toggleEvent(id)
                }}
                updating={updatingFilters}
              />
            </>
          )}
        </section>
      )}
      <MessagePreview
        active={active}
        days={days}
        updating={updatingFilters}
        selection={proposals.selection}
        timezone={search ? zoneLabel(search.displayTimezone) : ''}
        startMinutes={search?.startMinutes}
      />
    </div>
  )
}
