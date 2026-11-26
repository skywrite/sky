import { Alert, Button, Loader, Select, Textarea, TextInput } from '@mantine/core'
import { Fragment, type ReactNode, useEffect, useRef, useState } from 'react'
import { calendarConference } from '#lib/calendarScheduler/conference.ts'
import { recurrenceLabel } from '#lib/calendarScheduler/recurrence.ts'
import type {
  CalendarAvailability,
  CalendarDraft,
  CalendarFields,
  CalendarGuest,
  CalendarJob,
  CalendarSetup,
} from '#lib/calendarScheduler/types.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { createBlocker, defaultMeetingAccount, type MeetingBlockerTarget } from './createBlocker.ts'
import { MeetingGoogleSignIn, useMeetingBrowser } from './meetingBrowser.tsx'
import { mergeMeetingDraft } from './meetingDraft.ts'
import { MeetingGuests } from './meetingGuests.tsx'
import { MeetingRequestError, meetingRequest } from './meetingRequest.ts'
export { MeetingRequestError, meetingRequest } from './meetingRequest.ts'
import './meeting.css'

const PENDING_KEY = 'sky-meeting-request'
const browserTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
const zones = () => [...new Set(['UTC', browserTimezone(), ...Intl.supportedValuesOf('timeZone')])]

function clock(time: string): string {
  const [hours, minutes] = time.split(':').map(Number)
  return `${hours! % 12 || 12}:${String(minutes).padStart(2, '0')} ${hours! >= 12 ? 'PM' : 'AM'}`
}

function dayLabel(date: string): string {
  try {
    return `${new PlainDate(date).dayLong}, ${date}`
  } catch {
    return date
  }
}

function eventClock(value: string, day: string): string {
  return `${value.startsWith(day) ? '' : `${value.slice(0, 10)} · `}${clock(value.slice(11, 16))}`
}

export function MeetingDetails({
  draft,
  accounts,
  onChange,
}: {
  draft: CalendarDraft
  accounts: string[]
  onChange: (change: (draft: CalendarDraft) => CalendarDraft) => void
}) {
  const fields = draft.fields
  const guests = draft.invitees
    .flatMap((invitee) => (invitee.selected ? [invitee.selected] : []))
    .filter((guest) => guest.email.toLowerCase() !== fields.account.toLowerCase())
  const conference = calendarConference({ ...fields, guests })
  const missingAccount = !fields.account && accounts.length > 0
  const change = <K extends keyof CalendarFields>(key: K, value: CalendarFields[K]) =>
    onChange((current) => ({ ...current, assumptions: [], questions: [], fields: { ...current.fields, [key]: value } }))
  return (
    <section className="sky-meeting-details" aria-label="Meeting details">
      <div className="sky-meeting-section-label sky-meeting-details-heading">Your event</div>
      <TextInput
        className="sky-meeting-title-field"
        label="Title"
        aria-label="Meeting title"
        value={fields.title}
        onChange={(event) => change('title', event.currentTarget.value)}
      />
      <div className="sky-meeting-account" data-missing={missingAccount || undefined}>
        <Select
          label="From"
          aria-label="Send from"
          placeholder="Choose your Google account"
          data={accounts}
          value={fields.account || null}
          allowDeselect={false}
          onChange={(value) => change('account', value ?? '')}
          comboboxProps={{ withinPortal: false }}
        />
        {missingAccount && (
          <p className="sky-meeting-account-hint">Choose which Google account will organize this event.</p>
        )}
      </div>
      <MeetingGuests
        value={draft.invitees}
        account={fields.account}
        onChange={(invitees) => onChange((current) => ({ ...current, assumptions: [], invitees }))}
      />
      <div className="sky-meeting-when">
        <TextInput
          label="Date"
          type="date"
          value={fields.date}
          onChange={(event) => change('date', event.currentTarget.value)}
        />
        <TextInput
          label="Time"
          type="time"
          value={fields.time}
          onChange={(event) => change('time', event.currentTarget.value)}
        />
        <TextInput
          label="Minutes"
          type="number"
          min={5}
          max={720}
          step={5}
          value={fields.duration}
          onChange={(event) => change('duration', Number(event.currentTarget.value))}
        />
      </div>
      <Select
        label="Timezone"
        aria-label="Timezone"
        searchable
        data={[...new Set([fields.timezone, ...zones()])].filter(Boolean)}
        value={fields.timezone}
        onChange={(value) => {
          if (value) change('timezone', value)
        }}
        comboboxProps={{ withinPortal: false }}
      />
      <Select
        label="Repeat"
        value={fields.recurrence?.frequency ?? 'none'}
        data={[
          { value: 'none', label: 'Does not repeat' },
          { value: 'daily', label: 'Daily' },
          { value: 'weekly', label: 'Weekly' },
          { value: 'monthly', label: 'Monthly' },
          { value: 'yearly', label: 'Yearly' },
        ]}
        onChange={(value) => {
          if (value === 'none') change('recurrence', undefined)
          else if (value === 'daily' || value === 'weekly' || value === 'monthly' || value === 'yearly')
            change('recurrence', {
              frequency: value,
              interval: fields.recurrence?.interval ?? 1,
              ends: fields.recurrence?.ends ?? { type: 'never' },
            })
        }}
        comboboxProps={{ withinPortal: false }}
      />
      {fields.recurrence && (
        <>
          <div className="sky-meeting-when">
            <TextInput
              label="Repeat every"
              type="number"
              min={1}
              max={99}
              value={fields.recurrence.interval}
              onChange={(event) =>
                change('recurrence', { ...fields.recurrence!, interval: Number(event.currentTarget.value) })
              }
            />
            <Select
              label="Ends"
              value={fields.recurrence.ends.type}
              data={[
                { value: 'never', label: 'Never' },
                { value: 'on', label: 'On date' },
                { value: 'after', label: 'After' },
              ]}
              onChange={(value) => {
                if (value === 'never' || value === 'on' || value === 'after')
                  change('recurrence', {
                    ...fields.recurrence!,
                    ends:
                      value === 'on'
                        ? { type: 'on', date: fields.date }
                        : value === 'after'
                          ? { type: 'after', count: 1 }
                          : { type: 'never' },
                  })
              }}
              comboboxProps={{ withinPortal: false }}
            />
            {fields.recurrence.ends.type === 'on' && (
              <TextInput
                label="End date"
                type="date"
                min={fields.date}
                value={fields.recurrence.ends.date}
                onChange={(event) =>
                  change('recurrence', { ...fields.recurrence!, ends: { type: 'on', date: event.currentTarget.value } })
                }
              />
            )}
            {fields.recurrence.ends.type === 'after' && (
              <TextInput
                label="Occurrences"
                type="number"
                min={1}
                max={730}
                value={fields.recurrence.ends.count}
                onChange={(event) =>
                  change('recurrence', {
                    ...fields.recurrence!,
                    ends: { type: 'after', count: Number(event.currentTarget.value) },
                  })
                }
              />
            )}
          </div>
          <p className="sky-meeting-note">{recurrenceLabel(fields)}</p>
        </>
      )}
      {draft.assumptions.length > 0 && <p className="sky-meeting-note">{draft.assumptions.join(' ')}</p>}
      {draft.questions.length > 0 && (
        <p className="sky-meeting-questions">{draft.questions.join(' ')} Adjust the details above.</p>
      )}
      <Select
        label="Video"
        aria-label="Video conferencing"
        data={[
          { value: 'none', label: 'None' },
          { value: 'zoom', label: 'Zoom' },
        ]}
        value={conference}
        onChange={(value) => {
          if (value === 'none' || value === 'zoom') change('conference', value)
        }}
        comboboxProps={{ withinPortal: false }}
      />
      <details className="sky-meeting-description">
        <summary>{fields.description ? 'Agenda or note' : 'Add an agenda or note'}</summary>
        <Textarea
          aria-label="Agenda or note"
          minRows={3}
          autosize
          value={fields.description}
          onChange={(event) => change('description', event.currentTarget.value)}
        />
      </details>
    </section>
  )
}

export function DaySchedule({
  available,
  busy,
  error,
  time,
  onTime,
  onRetry,
}: {
  available: CalendarAvailability | null
  busy: boolean
  error: string
  time: string
  onTime: (time: string) => void
  onRetry?: () => void
}) {
  const conflicts = available?.events.filter((event) => event.conflict) ?? []
  return (
    <aside className="sky-meeting-schedule" aria-label="Your day" aria-busy={busy}>
      <div className="sky-meeting-section-label">Your day {busy && <Loader size="xs" />}</div>
      {available ? (
        <>
          <h3>{dayLabel(available.date)}</h3>
          <div
            className="sky-meeting-availability"
            data-warning={conflicts.length > 0 || available.warnings.length > 0 || undefined}
            role="status"
          >
            <strong>
              {conflicts.length
                ? `${conflicts.length} scheduling conflict${conflicts.length === 1 ? '' : 's'}`
                : available.warnings.length
                  ? 'Availability is incomplete'
                  : available.scope === 'first_occurrence'
                    ? 'The first occurrence is clear'
                    : 'This time is clear'}
            </strong>
            <p>
              {conflicts.length
                ? `${clock(time)} overlaps with ${conflicts.map((event) => event.title).join(', ')}. You can still schedule this time.`
                : available.warnings.length
                  ? 'Some calendars could not be checked.'
                  : 'No conflicts on your connected calendars.'}
            </p>
          </div>
          {available.alternatives.length > 0 && (
            <div className="sky-meeting-alternatives">
              <span>Nearby free times</span>
              <div>
                {available.alternatives.map((alternative) => (
                  <Button
                    key={alternative}
                    size="compact-sm"
                    variant="primary-quiet"
                    onClick={() => onTime(alternative)}
                  >
                    {clock(alternative)}
                  </Button>
                ))}
              </div>
            </div>
          )}
          <ol className="sky-meeting-agenda">
            {available.events.map((event) => (
              <li key={event.id} data-conflict={event.conflict || undefined}>
                <div className="sky-meeting-agenda-time">
                  {event.allDay
                    ? 'All day'
                    : `${eventClock(event.start, available.date)} – ${eventClock(event.end, available.date)}`}
                </div>
                <strong>{event.title}</strong>
                <small>
                  {event.calendar}
                  {!event.busy && ' · Free'}
                  {event.conflict && ' · Overlaps'}
                </small>
              </li>
            ))}
          </ol>
          {available.warnings.map((warning) => (
            <p key={warning} className="sky-meeting-calendar-warning">
              {warning}
            </p>
          ))}
          <p className="sky-meeting-note">
            {available.scope === 'first_occurrence' &&
              'Only the first occurrence is checked; later dates are not checked. '}
            {available.calendars.length} calendar{available.calendars.length === 1 ? '' : 's'} checked. Guests’
            availability isn’t checked.
          </p>
        </>
      ) : (
        <div className="sky-meeting-empty-schedule">
          <p className="sky-meeting-note" role={error ? 'alert' : 'status'}>
            {error || (busy ? 'Checking your calendars…' : 'Choose a date and time to see your schedule.')}
          </p>
          {error && onRetry && (
            <Button size="compact-sm" onClick={onRetry}>
              Retry
            </Button>
          )}
        </div>
      )}
    </aside>
  )
}

export function MeetingComposer({
  opened,
  query,
  setQuery,
  onClose,
}: {
  opened: boolean
  query: string
  setQuery: (text: string) => void
  onClose: () => void
}) {
  const [setup, setSetup] = useState<CalendarSetup | null>(null)
  const [setupError, setSetupError] = useState('')
  const [parsedQuery, setParsedQuery] = useState('')
  const [draft, setDraft] = useState<CalendarDraft | null>(null)
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState('')
  const [parseAttempt, setParseAttempt] = useState(0)
  const [error, setError] = useState('')
  const [available, setAvailable] = useState<CalendarAvailability | null>(null)
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [job, setJob] = useState<CalendarJob | null>(null)
  const [sending, setSending] = useState(false)
  const [sentFields, setSentFields] = useState<CalendarFields | null>(null)
  const [copied, setCopied] = useState(false)
  const parseRequest = useRef<AbortController | null>(null)
  const parseSequence = useRef(0)
  const lastInference = useRef<{ query: string; draft: CalendarDraft } | null>(null)
  const fieldEdits = useRef<Partial<Record<keyof CalendarFields, number>>>({})
  const parseImmediately = useRef(false)
  const submitting = useRef(false)
  const fields = draft?.fields
  const timingKey = fields
    ? JSON.stringify({
        date: fields.date,
        time: fields.time,
        timezone: fields.timezone,
        duration: fields.duration,
        recurrence: fields.recurrence,
      })
    : ''
  useEffect(() => {
    if (opened) document.title = `sky · ${job?.result?.title || fields?.title || 'Book a meeting'}`
  }, [opened, job?.result?.title, fields?.title])

  const active = sending || job?.state === 'creating'
  const browserAccount = job ? (sentFields?.account ?? '') : (fields?.account ?? '')
  const connection = useMeetingBrowser(
    browserAccount,
    opened &&
      !active &&
      (!job || job.state === 'failed') &&
      (setup?.browserSignIn === true || job?.recovery === 'google_sign_in'),
    job?.recovery === 'google_sign_in' ? (job.attemptId ?? job.id) : undefined,
  )
  const defaultAccount = defaultMeetingAccount(setup)
  const parseContext = useRef({ timezone: '', account: '' })
  parseContext.current = {
    timezone: fields?.timezone || setup?.timezone || browserTimezone(),
    account: fields?.account || defaultAccount,
  }

  useEffect(() => {
    if (defaultAccount && draft && !draft.fields.account) {
      setDraft({ ...draft, fields: { ...draft.fields, account: defaultAccount } })
    }
  }, [defaultAccount, draft])

  useEffect(() => {
    parseRequest.current?.abort()
    const sequence = ++parseSequence.current
    setParsing(false)
    const delay = parseImmediately.current ? 0 : 400
    parseImmediately.current = false
    if (!opened || active || job) return
    const text = query.trim()
    setParseError('')
    if (!text) {
      lastInference.current = null
      fieldEdits.current = {}
      setDraft(null)
      setParsedQuery('')
      return
    }
    if (text === lastInference.current?.query) return
    const controller = new AbortController()
    parseRequest.current = controller
    const editsAtStart = { ...fieldEdits.current }
    const timer = setTimeout(() => {
      setParsing(true)
      void meetingRequest<CalendarDraft>(
        'parse',
        { query: text, timezone: parseContext.current.timezone },
        controller.signal,
      )
        .then((next) => {
          if (controller.signal.aborted || sequence !== parseSequence.current) return
          next.fields.account = parseContext.current.account
          const previous = lastInference.current?.draft ?? null
          const editedDuringRequest = new Set(
            (Object.keys(fieldEdits.current) as Array<keyof CalendarFields>).filter(
              (key) => fieldEdits.current[key] !== editsAtStart[key],
            ),
          )
          setDraft((current) => mergeMeetingDraft(current, previous, next, editedDuringRequest))
          lastInference.current = { query: text, draft: next }
          setParsedQuery(text)
        })
        .catch((failure: unknown) => {
          if (!controller.signal.aborted && sequence === parseSequence.current)
            setParseError(failure instanceof Error ? failure.message : 'Could not interpret this meeting.')
        })
        .finally(() => {
          if (!controller.signal.aborted && sequence === parseSequence.current) setParsing(false)
        })
    }, delay)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [opened, query, active, job?.id, parseAttempt])

  useEffect(() => {
    if (!opened) return
    const controller = new AbortController()
    meetingRequest<CalendarSetup>('setup', undefined, controller.signal)
      .then((data) => {
        setSetupError('')
        setSetup(data)
        if (!data.accounts.length) setError('Connect a Google account with calendar access in Settings → Connections.')
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) {
          const message = failure instanceof Error ? failure.message : 'Could not load calendar accounts.'
          setSetupError(message)
          setError(message)
        }
      })
    try {
      const stored = sessionStorage.getItem(PENDING_KEY)
      if (stored) {
        const pending = JSON.parse(stored) as { id: string; fields: CalendarFields }
        setSentFields(pending.fields)
        setJob({ id: pending.id, state: 'creating' })
      }
    } catch {
      /* The current draft is still usable if browser storage is unavailable. */
    }
    return () => controller.abort()
  }, [opened])

  useEffect(() => {
    if (!opened || active) return
    const update = () => setRefresh((value) => value + 1)
    const timer = setInterval(update, 60_000)
    window.addEventListener('focus', update)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', update)
    }
  }, [opened, active])

  useEffect(() => {
    setAvailable(null)
    setCheckError('')
    if (!opened || !timingKey || active) {
      setChecking(false)
      return
    }
    const timing = JSON.parse(timingKey) as CalendarFields
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(timing.date) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(timing.time) ||
      !timing.timezone
    ) {
      setChecking(false)
      return
    }
    const controller = new AbortController()
    setChecking(true)
    const timer = setTimeout(() => {
      meetingRequest<CalendarAvailability>('preview', timing, controller.signal)
        .then((data) => {
          if (!controller.signal.aborted) setAvailable(data)
        })
        .catch((failure: unknown) => {
          if (!controller.signal.aborted)
            setCheckError(failure instanceof Error ? failure.message : 'Could not check calendars.')
        })
        .finally(() => {
          if (!controller.signal.aborted) setChecking(false)
        })
    }, 300)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [opened, timingKey, refresh, active])

  useEffect(() => {
    if (!job) return
    if (job.state !== 'creating') {
      if (job.state !== 'uncertain') {
        try {
          sessionStorage.removeItem(PENDING_KEY)
        } catch {}
      }
      return
    }
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const next = await meetingRequest<CalendarJob>(`jobs/${encodeURIComponent(job.id)}`)
        if (stopped) return
        setJob(next)
        setError('')
        if (next.state !== 'creating') {
          if (next.state !== 'uncertain') sessionStorage.removeItem(PENDING_KEY)
          return
        }
      } catch (failure) {
        if (stopped) return
        if (failure instanceof MeetingRequestError && failure.status === 404) {
          setJob({
            id: job.id,
            state: 'uncertain',
            message: 'Sky has no saved result for this request. Check Google Calendar before trying again.',
          })
          return
        }
        setError('Waiting to reconnect. Sky is checking the existing request; no second invite will be sent.')
      }
      timer = setTimeout(() => void poll(), 2000)
    }
    void poll()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [job?.id, job?.state])

  const change = <K extends keyof CalendarFields>(key: K, value: CalendarFields[K]) => {
    fieldEdits.current[key] = (fieldEdits.current[key] ?? 0) + 1
    setDraft((current) =>
      current ? { ...current, assumptions: [], questions: [], fields: { ...current.fields, [key]: value } } : current,
    )
  }
  const retryParse = () => {
    parseImmediately.current = true
    setParseAttempt((value) => value + 1)
  }

  const unresolved = draft?.invitees.filter((invitee) => !invitee.selected).length ?? 0
  const guests = [
    ...new Map<string, CalendarGuest>(
      (draft?.invitees.flatMap((invitee) => (invitee.selected ? [invitee.selected] : [])) ?? []).map(
        (guest) => [guest.email.toLowerCase(), guest] as const,
      ),
    ).values(),
  ].filter((guest) => guest.email.toLowerCase() !== fields?.account.toLowerCase())
  const conference = calendarConference({ ...fields, guests })
  const stale = query.trim() !== parsedQuery
  const blocker = createBlocker({
    draft,
    setup,
    setupError,
    available,
    checking,
    checkError,
    parsing,
    parseError,
    stale,
    unresolved,
    connection,
  })
  const canCreate = !!draft && !active && !blocker
  const conflicts = available?.events.filter((event) => event.conflict).length ?? 0
  const scrollMeetingBodyTo = (target: HTMLElement | null, always = false) => {
    const body = document.querySelector<HTMLElement>('.sky-meeting-body')
    if (!body || !target) return
    const bodyRect = body.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()
    if (!always && targetRect.top >= bodyRect.top + 8 && targetRect.bottom <= bodyRect.bottom - 8) return
    body.scrollTop = Math.max(0, body.scrollTop + targetRect.top - bodyRect.top - 16)
  }
  const resolveBlocker = (target: MeetingBlockerTarget) => {
    if (target === 'retry-parse') {
      retryParse()
      return
    }
    if (target === 'retry-check') {
      setRefresh((value) => value + 1)
      return
    }
    if (target === 'account') {
      const row = document.querySelector<HTMLElement>('.sky-meeting-account')
      scrollMeetingBodyTo(row)
      const input = row?.querySelector<HTMLInputElement>('input[aria-label="Send from"]')
      input?.focus({ preventScroll: true })
      input?.click()
      return
    }
    if (target === 'title') {
      const row = document.querySelector<HTMLElement>('.sky-meeting-title-field')
      scrollMeetingBodyTo(row)
      row?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true })
      return
    }
    if (target === 'invitee') {
      const card = document.querySelector<HTMLElement>('.sky-meeting-guest[data-unresolved]')
      scrollMeetingBodyTo(card)
      card?.querySelector<HTMLElement>('input, button')?.focus({ preventScroll: true })
      return
    }
    if (target === 'date' || target === 'time') {
      const row = document.querySelector<HTMLElement>('.sky-meeting-when')
      scrollMeetingBodyTo(row)
      row?.querySelector<HTMLInputElement>(`input[type="${target}"]`)?.focus({ preventScroll: true })
      return
    }
    if (target === 'timezone') {
      const input = document.querySelector<HTMLInputElement>('.sky-meeting-details input[aria-label="Timezone"]')
      scrollMeetingBodyTo(input?.closest<HTMLElement>('.mantine-InputWrapper-root') ?? input)
      input?.focus({ preventScroll: true })
      return
    }
    if (target === 'unsupported') {
      scrollMeetingBodyTo(document.querySelector<HTMLElement>('.sky-meeting-unsupported'))
      return
    }
    if (target === 'browser') {
      const banner = document.querySelector<HTMLElement>('.sky-meeting-browser')
      scrollMeetingBodyTo(banner)
      banner?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true })
      return
    }
    if (target === 'prompt') {
      const prompt = document.querySelector<HTMLElement>('.sky-meeting-prompt')
      scrollMeetingBodyTo(prompt)
      document.querySelector<HTMLTextAreaElement>('#sky-meeting-query')?.focus({ preventScroll: true })
    }
  }
  const create = async () => {
    if (!canCreate || !fields || !available || submitting.current) return
    submitting.current = true
    setSending(true)
    setError('')
    const id = crypto.randomUUID()
    const finalFields = { ...fields, guests }
    setSentFields(finalFields)
    try {
      sessionStorage.setItem(PENDING_KEY, JSON.stringify({ id, fields: finalFields }))
    } catch {
      /* Server idempotency still covers this page. */
    }
    try {
      setJob(await meetingRequest<CalendarJob>('create', { id, fields: finalFields, reviewKey: available.reviewKey }))
    } catch (failure) {
      if (failure instanceof MeetingRequestError && [400, 403, 415].includes(failure.status)) {
        setError(failure.message)
        try {
          sessionStorage.removeItem(PENDING_KEY)
        } catch {}
        return
      }
      // A lost POST response may follow a successful save. Query the same id before offering a retry.
      try {
        setJob(await meetingRequest<CalendarJob>(`jobs/${id}`))
      } catch {
        setError(failure instanceof Error ? failure.message : 'Could not start the meeting.')
        setJob({
          id,
          state: 'uncertain',
          message: 'The request could not be confirmed. Check Google Calendar before trying again.',
        })
      }
    } finally {
      setSending(false)
      submitting.current = false
    }
  }

  const reset = () => {
    parseRequest.current?.abort()
    lastInference.current = null
    fieldEdits.current = {}
    parseImmediately.current = false
    setJob(null)
    setSentFields(null)
    setDraft(null)
    setQuery('')
    setParsedQuery('')
    setParseError('')
    setError('')
    setCopied(false)
    sessionStorage.removeItem(PENDING_KEY)
  }
  const calendarUrl =
    job?.result?.calendarUrl ??
    `https://calendar.google.com/calendar/u/0/r?authuser=${encodeURIComponent(sentFields?.account ?? '')}`

  return (
    <>
      {job || sending ? (
        <div className="sky-meeting-outcome" aria-live="polite">
          {active ? (
            <>
              <Loader size="lg" />
              <h2>Creating your event</h2>
              <p>
                {sentFields && calendarConference(sentFields) === 'zoom'
                  ? 'Getting a fresh Zoom link and saving to your calendar…'
                  : 'Saving to your calendar…'}
              </p>
            </>
          ) : job?.state === 'created' ? (
            <>
              <span className="sky-meeting-success" aria-hidden="true">
                ✓
              </span>
              <h2>
                {sentFields?.recurrence
                  ? 'Series scheduled'
                  : sentFields?.guests.length
                    ? 'Meeting scheduled'
                    : 'Time blocked'}
              </h2>
              <p>{job.result?.title}</p>
              {sentFields && (
                <p className="sky-meeting-note">
                  {dayLabel(sentFields.date)} · {clock(sentFields.time)} · {sentFields.duration} min
                  <br />
                  {sentFields.timezone}
                  <br />
                  {sentFields.account && (
                    <>
                      From {sentFields.account}
                      <br />
                    </>
                  )}
                  {sentFields.recurrence && (
                    <>
                      {recurrenceLabel(sentFields)}
                      <br />
                    </>
                  )}
                  {sentFields.guests.length
                    ? `Invitations sent to ${sentFields.guests.map((guest) => guest.name || guest.email).join(', ')}.`
                    : 'Only on your calendar.'}
                </p>
              )}
              <div className="sky-meeting-outcome-actions">
                <Button component="a" href={calendarUrl} target="_blank" rel="noreferrer" variant="primary">
                  Open in Calendar
                </Button>
                {job.result?.zoomUrl && (
                  <Button
                    onClick={() => {
                      if (job.result)
                        void navigator.clipboard
                          .writeText(job.result.zoomUrl)
                          .then(() => setCopied(true))
                          .catch(() => setError('Could not copy the link. Open the meeting in Calendar.'))
                    }}
                  >
                    {copied ? 'Copied' : 'Copy Zoom link'}
                  </Button>
                )}
              </div>
              <Button
                onClick={() => {
                  reset()
                  onClose()
                }}
              >
                Done
              </Button>
            </>
          ) : (
            <>
              <h2>{job?.state === 'uncertain' ? 'Check Calendar before retrying' : 'The meeting wasn’t created'}</h2>
              {job?.recovery !== 'google_sign_in' && <p>{job?.message}</p>}
              <MeetingGoogleSignIn connection={connection} />
              <Button component="a" href={calendarUrl} target="_blank" rel="noreferrer" variant="primary">
                Open Google Calendar
              </Button>
              {(job?.state === 'failed' || job?.state === 'uncertain') && (
                <Button
                  onClick={() => {
                    if (!draft && sentFields) {
                      const recoveredQuery = query || sentFields.title
                      setQuery(recoveredQuery)
                      setParsedQuery(recoveredQuery)
                      const recovered: CalendarDraft = {
                        fields: sentFields,
                        invitees: sentFields.guests.map((guest) => ({
                          query: guest.name,
                          candidates: [],
                          selected: guest,
                        })),
                        assumptions: [],
                        questions: [],
                        unsupported: [],
                      }
                      lastInference.current = { query: recoveredQuery, draft: recovered }
                      setDraft(recovered)
                    }
                    setJob(null)
                    setError('')
                    try {
                      sessionStorage.removeItem(PENDING_KEY)
                    } catch {}
                    setRefresh((value) => value + 1)
                  }}
                >
                  {job.state === 'uncertain' ? 'I checked Calendar — return to draft' : 'Back to draft'}
                </Button>
              )}
            </>
          )}
          {error && (
            <p className="sky-meeting-note" role="status">
              {error}
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="sky-meeting-body">
            <div className="sky-meeting-prompt">
              <label className="sky-meeting-prompt-label" htmlFor="sky-meeting-query">
                What are we scheduling?
              </label>
              <Textarea
                id="sky-meeting-query"
                placeholder="Meet Jane on Friday at 3 PM, or block off 1–3 PM for focus time."
                autosize
                minRows={2}
                maxRows={5}
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && query.trim()) {
                    event.preventDefault()
                    retryParse()
                  }
                }}
                autoFocus={opened}
              />
              <div className="sky-meeting-prompt-foot">
                <span role="status">
                  {(parsing || stale) && query.trim() && !parseError ? (
                    <>
                      <Loader size="xs" /> Updating details…
                    </>
                  ) : draft ? (
                    'Keep typing, or adjust the details below.'
                  ) : (
                    'Details appear as you type. You review before creating the event.'
                  )}
                </span>
              </div>
            </div>
            {error && (
              <Alert color="red" role="alert">
                {error}
              </Alert>
            )}
            {parseError && (
              <Alert color="red" role="alert">
                {parseError}{' '}
                <Button size="compact-sm" onClick={retryParse}>
                  Retry
                </Button>
              </Alert>
            )}
            {draft && fields && (
              <>
                <MeetingGoogleSignIn connection={connection} />
                {draft.unsupported.length > 0 && (
                  <Alert className="sky-meeting-unsupported" color="yellow">
                    {draft.unsupported.join(' ')}
                  </Alert>
                )}
                <div className="sky-meeting-review" aria-busy={stale || parsing}>
                  <MeetingDetails
                    draft={draft}
                    accounts={setup?.accounts ?? []}
                    onChange={(update) => {
                      const next = update(draft)
                      for (const key of Object.keys(next.fields) as Array<keyof CalendarFields>) {
                        if (next.fields[key] !== fields[key])
                          fieldEdits.current[key] = (fieldEdits.current[key] ?? 0) + 1
                      }
                      setDraft((current) => (current ? update(current) : current))
                    }}
                  />
                  <DaySchedule
                    available={available}
                    busy={checking}
                    error={checkError}
                    time={fields.time}
                    onTime={(time) => change('time', time)}
                    onRetry={() => setRefresh((value) => value + 1)}
                  />
                </div>
              </>
            )}
          </div>
          <footer className="sky-dialog-footer sky-meeting-footer">
            <div className="sky-meeting-footer-summary">
              {draft && fields ? (
                (() => {
                  const reviewDayButton =
                    conflicts || available?.warnings.length ? (
                      <button
                        type="button"
                        className="sky-meeting-review-day"
                        onClick={() =>
                          scrollMeetingBodyTo(document.querySelector<HTMLElement>('.sky-meeting-schedule'), true)
                        }
                      >
                        {conflicts ? `${conflicts} conflict${conflicts === 1 ? '' : 's'}` : 'Availability incomplete'} ·
                        Review your day
                      </button>
                    ) : null
                  const metaItems: Array<{ key: string; node: ReactNode }> = []
                  if (blocker) {
                    if (fields.account) {
                      metaItems.push({
                        key: 'account',
                        node: <span className="sky-meeting-footer-account">From {fields.account}</span>,
                      })
                    }
                    if (!unresolved) {
                      metaItems.push({
                        key: 'guests',
                        node: (
                          <span>
                            {guests.length
                              ? `${guests.length} invitation${guests.length === 1 ? '' : 's'}`
                              : 'Only on your calendar'}
                          </span>
                        ),
                      })
                    } else if (blocker.target !== 'invitee') {
                      metaItems.push({
                        key: 'unresolved',
                        node: (
                          <span>
                            {unresolved} invitee{unresolved === 1 ? '' : 's'} to resolve
                          </span>
                        ),
                      })
                    }
                    if (reviewDayButton) metaItems.push({ key: 'review', node: reviewDayButton })
                  } else {
                    if (reviewDayButton) metaItems.push({ key: 'review', node: reviewDayButton })
                    metaItems.push({
                      key: 'video',
                      node: <span>{conference === 'zoom' ? 'A fresh Zoom link' : 'No video link'}</span>,
                    })
                  }
                  return (
                    <>
                      <div className="sky-meeting-footer-main">
                        {blocker ? (
                          blocker.pending ? (
                            <span className="sky-meeting-blocker-pending" role="status">
                              <Loader size="xs" /> {blocker.message}
                            </span>
                          ) : blocker.target === 'connections' ? (
                            <a href="/settings/connections" className="sky-meeting-blocker">
                              {blocker.message}
                            </a>
                          ) : blocker.target ? (
                            <button
                              type="button"
                              className="sky-meeting-blocker"
                              onClick={() => resolveBlocker(blocker.target!)}
                            >
                              {blocker.message}
                            </button>
                          ) : (
                            <span className="sky-meeting-blocker-text">{blocker.message}</span>
                          )
                        ) : (
                          <>
                            <strong>
                              {guests.length
                                ? `${guests.length} invitation${guests.length === 1 ? '' : 's'}`
                                : 'Only on your calendar'}
                            </strong>
                            <span className="sky-meeting-footer-sep" aria-hidden="true">
                              ·
                            </span>
                            <span className="sky-meeting-footer-account">
                              From <strong>{fields.account}</strong>
                            </span>
                          </>
                        )}
                      </div>
                      {metaItems.length > 0 && (
                        <div className="sky-meeting-footer-meta">
                          {metaItems.map((item, index) => (
                            <Fragment key={item.key}>
                              {index > 0 && (
                                <span className="sky-meeting-footer-sep" aria-hidden="true">
                                  ·
                                </span>
                              )}
                              {item.node}
                            </Fragment>
                          ))}
                        </div>
                      )}
                    </>
                  )
                })()
              ) : (
                <span>Block off time or invite others. Video conferencing is optional.</span>
              )}
            </div>
            <div className="sky-meeting-footer-actions">
              <Button onClick={onClose}>Cancel</Button>
              {draft && (
                <Button variant={conflicts ? 'warning' : 'primary'} disabled={!canCreate} onClick={() => void create()}>
                  {fields?.recurrence
                    ? guests.length || unresolved
                      ? 'Create series & send invites'
                      : 'Create series'
                    : guests.length || unresolved
                      ? 'Create & send invites'
                      : 'Create event'}
                </Button>
              )}
            </div>
          </footer>
        </>
      )}
    </>
  )
}

export { clock as meetingClock, dayLabel as meetingDayLabel }
