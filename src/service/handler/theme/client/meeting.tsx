import { Alert, Button, Loader, Modal, Select, Textarea, TextInput } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { useEffect, useRef, useState } from 'react'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import type {
  MeetingAvailability,
  MeetingDraft,
  MeetingFields,
  MeetingGuest,
  MeetingJob,
  MeetingSetup,
} from '../../meetings/types.ts'
import { mergeMeetingDraft } from './meetingDraft.ts'
import { MeetingGuests } from './meetingGuests.tsx'
import './meeting.css'

const PENDING_KEY = 'sky-meeting-request'
const browserTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
const zones = () => [...new Set(['UTC', browserTimezone(), ...Intl.supportedValuesOf('timeZone')])]

class MeetingRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

async function request<T>(url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(
    `/meetings/_api/${url}`,
    body === undefined
      ? { signal }
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal,
        },
  )
  const data = (await response.json().catch(() => ({}))) as T & { message?: string }
  if (!response.ok)
    throw new MeetingRequestError(data.message ?? 'Could not reach the meeting service. Try again.', response.status)
  return data
}

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

function CalendarIcon() {
  return (
    <svg
      aria-hidden="true"
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M7 3v4m10-4v4M3 11h18m-9 3v4m-2-2h4" />
    </svg>
  )
}

function DaySchedule({
  available,
  busy,
  error,
  time,
  onTime,
}: {
  available: MeetingAvailability | null
  busy: boolean
  error: string
  time: string
  onTime: (time: string) => void
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
                  : 'This time is clear'}
            </strong>
            <p>
              {conflicts.length
                ? `${clock(time)} overlaps with ${conflicts.map((event) => event.title).join(', ')}.`
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
                  <Button key={alternative} size="compact-sm" variant="primary" onClick={() => onTime(alternative)}>
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
            {available.calendars.length} calendar{available.calendars.length === 1 ? '' : 's'} checked. Guests’
            availability isn’t checked.
          </p>
        </>
      ) : (
        <p className="sky-meeting-note" role={error ? 'alert' : 'status'}>
          {error || (busy ? 'Checking your calendars…' : 'Choose a date and time to see your schedule.')}
        </p>
      )}
    </aside>
  )
}

export function MeetingDialog({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const phone = useMediaQuery('(max-width: 900px)') ?? false
  const [setup, setSetup] = useState<MeetingSetup | null>(null)
  const [query, setQuery] = useState('')
  const [parsedQuery, setParsedQuery] = useState('')
  const [draft, setDraft] = useState<MeetingDraft | null>(null)
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState('')
  const [parseAttempt, setParseAttempt] = useState(0)
  const [error, setError] = useState('')
  const [available, setAvailable] = useState<MeetingAvailability | null>(null)
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [job, setJob] = useState<MeetingJob | null>(null)
  const [sending, setSending] = useState(false)
  const [sentFields, setSentFields] = useState<MeetingFields | null>(null)
  const [copied, setCopied] = useState(false)
  const parseRequest = useRef<AbortController | null>(null)
  const parseSequence = useRef(0)
  const lastInference = useRef<{ query: string; draft: MeetingDraft } | null>(null)
  const fieldEdits = useRef<Partial<Record<keyof MeetingFields, number>>>({})
  const parseImmediately = useRef(false)
  const submitting = useRef(false)
  const fields = draft?.fields
  const timingKey = fields
    ? JSON.stringify({ date: fields.date, time: fields.time, timezone: fields.timezone, duration: fields.duration })
    : ''
  const active = sending || job?.state === 'creating'
  const parseContext = useRef({ timezone: '', account: '' })
  parseContext.current = {
    timezone: fields?.timezone || setup?.timezone || browserTimezone(),
    account: fields?.account || (setup?.accounts.length === 1 ? setup.accounts[0]! : ''),
  }

  useEffect(() => {
    if (setup?.accounts.length === 1 && draft && !draft.fields.account) {
      setDraft({ ...draft, fields: { ...draft.fields, account: setup.accounts[0]! } })
    }
  }, [setup, draft])

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
      void request<MeetingDraft>('parse', { query: text, timezone: parseContext.current.timezone }, controller.signal)
        .then((next) => {
          if (controller.signal.aborted || sequence !== parseSequence.current) return
          next.fields.account = parseContext.current.account
          const previous = lastInference.current?.draft ?? null
          const editedDuringRequest = new Set(
            (Object.keys(fieldEdits.current) as Array<keyof MeetingFields>).filter(
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
    request<MeetingSetup>('setup', undefined, controller.signal)
      .then((data) => {
        setSetup(data)
        if (!data.accounts.length) setError('Connect a Google account with calendar access in Settings → Connections.')
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted)
          setError(failure instanceof Error ? failure.message : 'Could not load calendar accounts.')
      })
    try {
      const stored = sessionStorage.getItem(PENDING_KEY)
      if (stored) {
        const pending = JSON.parse(stored) as { id: string; fields: MeetingFields }
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
    const timing = JSON.parse(timingKey) as MeetingFields
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
      request<MeetingAvailability>('preview', timing, controller.signal)
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
        const next = await request<MeetingJob>(`jobs/${encodeURIComponent(job.id)}`)
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

  const change = <K extends keyof MeetingFields>(key: K, value: MeetingFields[K]) => {
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
    ...new Map<string, MeetingGuest>(
      (draft?.invitees.flatMap((invitee) => (invitee.selected ? [invitee.selected] : [])) ?? []).map(
        (guest) => [guest.email.toLowerCase(), guest] as const,
      ),
    ).values(),
  ].filter((guest) => guest.email.toLowerCase() !== fields?.account.toLowerCase())
  const stale = query.trim() !== parsedQuery
  const canCreate =
    !!fields?.title.trim() &&
    !!fields.account &&
    guests.length > 0 &&
    !unresolved &&
    !draft?.unsupported.length &&
    !!available &&
    !checking &&
    !stale &&
    !parsing &&
    !active
  const conflicts = available?.events.filter((event) => event.conflict).length ?? 0
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
      setJob(await request<MeetingJob>('create', { id, fields: finalFields, reviewKey: available.reviewKey }))
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
        setJob(await request<MeetingJob>(`jobs/${id}`))
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
    <Modal
      opened={opened}
      onClose={() => {
        if (!active) onClose()
      }}
      fullScreen={phone}
      centered
      size={draft && !job ? 1020 : 680}
      padding={0}
      title={
        <span className="sky-meeting-dialog-title">
          <CalendarIcon />
          New meeting
        </span>
      }
      closeOnClickOutside={false}
      closeOnEscape={!active}
      withCloseButton={!active}
      classNames={{ content: 'sky-meeting-modal', body: 'sky-meeting-modal-body' }}
    >
      {job || sending ? (
        <div className="sky-meeting-outcome" aria-live="polite">
          {active ? (
            <>
              <Loader size="lg" />
              <h2>Creating your meeting</h2>
              <p>Getting a fresh Zoom link and sending the invitations…</p>
            </>
          ) : job?.state === 'created' ? (
            <>
              <span className="sky-meeting-success" aria-hidden="true">
                ✓
              </span>
              <h2>Meeting scheduled</h2>
              <p>{job.result?.title}</p>
              {sentFields && (
                <p className="sky-meeting-note">
                  {dayLabel(sentFields.date)} · {clock(sentFields.time)} · {sentFields.duration} min
                  <br />
                  {sentFields.timezone}
                  <br />
                  Invitations sent to {sentFields.guests.map((guest) => guest.name).join(', ')}.
                </p>
              )}
              <div className="sky-meeting-outcome-actions">
                <Button component="a" href={calendarUrl} target="_blank" rel="noreferrer" variant="primary">
                  Open in Calendar
                </Button>
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
              <p>{job?.message}</p>
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
                      const recovered: MeetingDraft = {
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
              <label htmlFor="sky-meeting-query">Who are we meeting?</label>
              <Textarea
                id="sky-meeting-query"
                placeholder="Meet with Jane on Friday at 3 PM for 30 minutes. Invite Sam too."
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
                data-autofocus
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
                    'People and time appear as you type. You review before sending.'
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
                {draft.unsupported.length > 0 && <Alert color="yellow">{draft.unsupported.join(' ')}</Alert>}
                <div className="sky-meeting-review" aria-busy={stale || parsing}>
                  <div className="sky-meeting-details">
                    <TextInput
                      label="Meeting title"
                      value={fields.title}
                      onChange={(event) => change('title', event.currentTarget.value)}
                    />
                    <MeetingGuests
                      value={draft.invitees}
                      onChange={(invitees) => setDraft((current) => (current ? { ...current, invitees } : current))}
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
                      searchable
                      data={[...new Set([fields.timezone, ...zones()])].filter(Boolean)}
                      value={fields.timezone}
                      onChange={(value) => {
                        if (value) change('timezone', value)
                      }}
                      comboboxProps={{ withinPortal: false }}
                    />
                    {draft.assumptions.length > 0 && <p className="sky-meeting-note">{draft.assumptions.join(' ')}</p>}
                    {draft.questions.length > 0 && (
                      <p className="sky-meeting-questions">{draft.questions.join(' ')} Adjust the details above.</p>
                    )}
                    <div className="sky-meeting-zoom">
                      <span className="sky-meeting-zoom-icon" aria-hidden="true">
                        <svg
                          width="22"
                          height="22"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.6"
                        >
                          <rect x="2" y="5" width="13" height="14" rx="3" />
                          <path d="m15 9 6-4v14l-6-4" />
                        </svg>
                      </span>
                      <span>
                        <strong>Zoom meeting</strong>
                        <small>A fresh link will be added when you create the meeting.</small>
                      </span>
                    </div>
                    <Select
                      label="Send from"
                      placeholder="Choose your Google account"
                      data={setup?.accounts ?? []}
                      value={fields.account || null}
                      onChange={(value) => change('account', value ?? '')}
                      comboboxProps={{ withinPortal: false }}
                    />
                    <details className="sky-meeting-description">
                      <summary>Add an agenda or note</summary>
                      <Textarea
                        aria-label="Agenda or note"
                        minRows={3}
                        autosize
                        value={fields.description}
                        onChange={(event) => change('description', event.currentTarget.value)}
                      />
                    </details>
                  </div>
                  <DaySchedule
                    available={available}
                    busy={checking}
                    error={checkError}
                    time={fields.time}
                    onTime={(time) => change('time', time)}
                  />
                </div>
              </>
            )}
          </div>
          <footer className="sky-dialog-footer sky-meeting-footer">
            <div>
              {draft ? (
                <>
                  <strong>
                    {unresolved
                      ? `${unresolved} invitee${unresolved === 1 ? '' : 's'} to resolve`
                      : `${guests.length} invitation${guests.length === 1 ? '' : 's'}`}
                  </strong>
                  {conflicts || available?.warnings.length ? (
                    <button
                      type="button"
                      className="sky-meeting-review-day"
                      onClick={() => {
                        const body = document.querySelector<HTMLElement>('.sky-meeting-body')
                        const schedule = document.querySelector<HTMLElement>('.sky-meeting-schedule')
                        if (body && schedule)
                          body.scrollTop += schedule.getBoundingClientRect().top - body.getBoundingClientRect().top
                      }}
                    >
                      {conflicts ? `${conflicts} conflict${conflicts === 1 ? '' : 's'}` : 'Availability incomplete'} ·
                      Review your day
                    </button>
                  ) : (
                    <span>A fresh Zoom link for everyone</span>
                  )}
                </>
              ) : (
                <span>One meeting. Everyone invited. A fresh Zoom link.</span>
              )}
            </div>
            {draft ? (
              <Button variant={conflicts ? 'warning' : 'primary'} disabled={!canCreate} onClick={() => void create()}>
                Create & send invites
              </Button>
            ) : (
              <Button onClick={onClose}>Cancel</Button>
            )}
          </footer>
        </>
      )}
    </Modal>
  )
}
