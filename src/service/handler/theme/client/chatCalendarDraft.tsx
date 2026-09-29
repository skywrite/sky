import { Button } from '@mantine/core'
import { useEffect, useRef, useState } from 'react'
import { calendarConference } from '#lib/calendarScheduler/conference.ts'
import { recurrenceLabel } from '#lib/calendarScheduler/recurrence.ts'
import type {
  CalendarAvailability,
  CalendarDraft,
  CalendarFields,
  CalendarGuest,
  CalendarJob,
  CalendarPreparedDraft,
  CalendarSetup,
} from '#lib/calendarScheduler/types.ts'
import type { Approval } from './chat.tsx'
import { DaySchedule, MeetingDetails, meetingClock, meetingDayLabel, meetingRequest } from './meeting.tsx'
import { RenderedHtml } from './renderedHtml.tsx'
import { renderStatic } from './wysiwyg/render.ts'
import './writingDraft.css'
import './chatCalendarDraft.css'

type Edit = { id: string; fields: CalendarFields; reviewKey: string }
const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : 'Could not update the meeting. Try again.'
function MeetingEditor({
  saved,
  accounts,
  busy,
  onChange,
}: {
  saved: CalendarPreparedDraft
  accounts: string[]
  busy: boolean
  onChange: (edit: Edit | null) => void
}) {
  const [draft, setDraft] = useState<CalendarDraft>(() => ({
    fields: saved.fields,
    invitees: saved.fields.guests.map((guest) => ({
      query: guest.name || guest.email,
      candidates: [],
      selected: guest,
    })),
    assumptions: saved.assumptions,
    questions: [],
    unsupported: [],
  }))
  const [checked, setChecked] = useState<{ timing: string; value: CalendarAvailability } | null>(null)
  const [checking, setChecking] = useState(true)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const fields = draft.fields
  const timing = JSON.stringify({
    date: fields.date,
    time: fields.time,
    timezone: fields.timezone,
    duration: fields.duration,
    recurrence: fields.recurrence,
  })
  const available = checked?.timing === timing ? checked.value : null
  const changeRef = useRef(onChange)
  changeRef.current = onChange

  useEffect(() => {
    const controller = new AbortController()
    setChecking(true)
    setChecked(null)
    setError('')
    const timer = setTimeout(() => {
      void meetingRequest<CalendarAvailability>('preview', JSON.parse(timing), controller.signal)
        .then((value) => {
          if (!controller.signal.aborted) setChecked({ timing, value })
        })
        .catch((failure) => {
          if (!controller.signal.aborted) setError(messageOf(failure))
        })
        .finally(() => {
          if (!controller.signal.aborted) setChecking(false)
        })
    }, 300)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [timing, refresh])

  useEffect(() => {
    const update = () => setRefresh((value) => value + 1)
    const timer = setInterval(update, 60_000)
    window.addEventListener('focus', update)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', update)
    }
  }, [])

  useEffect(() => {
    const guests = [
      ...new Map<string, CalendarGuest>(
        draft.invitees
          .flatMap((invitee) => (invitee.selected ? [invitee.selected] : []))
          .map((guest) => [guest.email.toLowerCase(), guest] as const),
      ).values(),
    ].filter((guest) => guest.email.toLowerCase() !== fields.account.toLowerCase())
    const ready =
      !!fields.title.trim() &&
      accounts.includes(fields.account) &&
      draft.invitees.every((invitee) => invitee.selected) &&
      !checking &&
      !!available
    changeRef.current(ready ? { id: saved.id, fields: { ...fields, guests }, reviewKey: available!.reviewKey } : null)
  }, [draft, accounts, checking, available])

  return (
    <fieldset className="sky-calendar-edit" disabled={busy}>
      <div className="sky-calendar-edit-grid">
        <MeetingDetails draft={draft} accounts={accounts} onChange={setDraft} />
        <div>
          <DaySchedule
            available={available}
            busy={checking}
            error={error}
            time={fields.time}
            onTime={(time) =>
              setDraft((current) => ({ ...current, assumptions: [], fields: { ...current.fields, time } }))
            }
          />
          {error && (
            <Button size="sm" onClick={() => setRefresh((value) => value + 1)}>
              Check again
            </Button>
          )}
        </div>
      </div>
    </fieldset>
  )
}

function MeetingPreview({
  draft,
  summary,
  created,
}: {
  draft: CalendarPreparedDraft
  summary?: string
  created?: boolean
}) {
  const { fields, availability } = draft
  const conflicts = availability?.events.filter((event) => event.conflict) ?? []
  const incomplete = !!availability?.warnings.length
  return (
    <div className="sky-calendar-preview">
      <h3>{fields.title}</h3>
      <p className="sky-calendar-when">
        <strong>{meetingDayLabel(fields.date)}</strong>
        <span>
          {meetingClock(fields.time)} · {fields.duration} min
        </span>
      </p>
      <p className="sky-calendar-zone">{fields.timezone}</p>
      <dl className="sky-calendar-facts">
        {fields.recurrence && (
          <div>
            <dt>Repeat</dt>
            <dd>{recurrenceLabel(fields)}</dd>
          </div>
        )}
        <div>
          <dt>Guests</dt>
          <dd>
            {fields.guests.length ? (
              <ul className="sky-calendar-guests">
                {fields.guests.map((guest) => (
                  <li key={guest.email}>
                    <span className="sky-meeting-avatar" aria-hidden="true">
                      {(guest.name || guest.email).slice(0, 1).toUpperCase()}
                    </span>
                    <span>
                      <strong>{guest.name || guest.email}</strong>
                      {guest.name && guest.name !== guest.email && <span>{guest.email}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              'Only on your calendar'
            )}
          </dd>
        </div>
        <div>
          <dt>From</dt>
          <dd>{fields.account}</dd>
        </div>
        <div>
          <dt>Video</dt>
          <dd>
            {calendarConference(fields) === 'zoom'
              ? created
                ? 'Zoom'
                : 'Zoom · a new link will be created'
              : 'No video link'}
          </dd>
        </div>
        {fields.description && (
          <div>
            <dt>Agenda</dt>
            <dd className="sky-calendar-agenda">{fields.description}</dd>
          </div>
        )}
      </dl>
      {!created &&
        (availability ? (
          <div className="sky-calendar-availability" data-warning={conflicts.length > 0 || incomplete || undefined}>
            <strong>
              {conflicts.length
                ? `${conflicts.length} scheduling conflict${conflicts.length === 1 ? '' : 's'}`
                : incomplete
                  ? 'Availability is incomplete'
                  : fields.recurrence
                    ? 'The first occurrence is clear'
                    : 'This time is clear'}
            </strong>
            <p>
              {conflicts.length
                ? conflicts.map((event) => `${event.title} · ${meetingClock(event.start.slice(11, 16))}`).join('; ')
                : incomplete
                  ? availability.warnings.join(' ')
                  : 'No conflicts on your checked calendars.'}
            </p>
            {conflicts.length > 0 && availability.warnings.map((warning) => <p key={warning}>{warning}</p>)}
            <span>{fields.recurrence && 'Later dates aren’t checked. '}Guests’ availability isn’t checked.</span>
          </div>
        ) : summary ? (
          <RenderedHtml className="sky-calendar-legacy sky-rendered" html={renderStatic(summary)} />
        ) : null)}
      {draft.assumptions.length > 0 && (
        <details className="sky-calendar-assumptions">
          <summary>Assumptions · {draft.assumptions.length}</summary>
          {draft.assumptions.map((assumption) => (
            <p key={assumption}>{assumption}</p>
          ))}
        </details>
      )}
    </div>
  )
}

function MeetingReceipt({ draft, job }: { draft: CalendarPreparedDraft; job?: CalendarJob }) {
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  const created = job?.state === 'created'
  const failed = job?.state === 'failed' || job?.state === 'uncertain'
  const calendarUrl =
    job?.result?.calendarUrl ??
    `https://calendar.google.com/calendar/u/0/r?authuser=${encodeURIComponent(draft.fields.account)}`

  return (
    <div className="sky-calendar-receipt" data-warning={failed || undefined} role={failed ? 'alert' : 'status'}>
      <strong>
        {created
          ? draft.fields.guests.length
            ? `${draft.fields.recurrence ? 'Series' : 'Event'} created · Invitations sent`
            : `${draft.fields.recurrence ? 'Series' : 'Event'} created`
          : job?.state === 'uncertain'
            ? 'Check Calendar before trying again'
            : failed
              ? 'The event wasn’t created'
              : !job
                ? 'Checking saved result…'
                : draft.fields.recurrence
                  ? 'Creating series…'
                  : 'Creating event…'}
      </strong>
      {job?.message && <p>{job.message}</p>}
      {(created || failed) && (
        <div className="sky-calendar-links">
          <Button component="a" href={calendarUrl} target="_blank" rel="noreferrer" size="sm" variant="primary-quiet">
            Open Calendar
          </Button>
          {created && job.result?.zoomUrl && (
            <>
              <Button component="a" href={job.result.zoomUrl} target="_blank" rel="noreferrer" size="sm">
                Open Zoom
              </Button>
              <Button
                size="sm"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(job.result!.zoomUrl)
                    .then(() => {
                      setCopied(true)
                      setError('')
                    })
                    .catch(() => setError('Could not copy the link. Use Open Zoom.'))
                }
              >
                {copied ? 'Copied' : 'Copy Zoom link'}
              </Button>
            </>
          )}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  )
}

function batchStatus(draft: CalendarPreparedDraft, job?: CalendarJob) {
  if (job) {
    if (job.state === 'created') return 'Created'
    if (job.state === 'uncertain') return 'Save unconfirmed'
    if (job.state === 'failed') return 'Failed'
    return 'Creating…'
  }
  if (draft.availability?.events.some((event) => event.conflict)) return 'Conflict'
  if (draft.availability?.warnings.length) return 'Check incomplete'
  return draft.availability ? 'Clear' : 'Review needed'
}

export function ChatCalendarDraft({
  approval,
  answered,
  onAnswer,
  chatId,
  onChange,
  settled = false,
}: {
  approval: Approval
  answered?: boolean
  chatId?: string
  onAnswer?: (approved: boolean, always?: boolean, revision?: number) => Promise<void>
  onChange?: (approval: Approval) => void
  settled?: boolean
}) {
  const drafts = approval.calendar!
  const [editing, setEditing] = useState<CalendarPreparedDraft[] | null>(null)
  const [editRevision, setEditRevision] = useState(0)
  const edits = useRef<Array<Edit | null>>([])
  const [ready, setReady] = useState(false)
  const [setup, setSetup] = useState<CalendarSetup | null>(null)
  const [busy, setBusy] = useState(false)
  const working = useRef(false)
  const [error, setError] = useState('')
  const [raw, setRaw] = useState(false)
  const [jobs, setJobs] = useState<Record<string, CalendarJob>>({})
  const [receiptError, setReceiptError] = useState('')
  const [selected, setSelected] = useState(0)
  const [pollRevision, setPollRevision] = useState(0)
  const activeIndex = Math.min(selected, drafts.length - 1)
  const activeDraft = drafts[activeIndex]!
  const sharedTitle = drafts.every((draft) => draft.fields.title === drafts[0]!.fields.title)
  const ids = drafts.map((draft) => draft.id).join(',')
  const editable = answered === undefined && !!onAnswer
  const conflicts = drafts.some(
    (draft) => draft.availability?.events.some((event) => event.conflict) || draft.availability?.warnings.length,
  )
  const guests = drafts.some((draft) => draft.fields.guests.length)

  useEffect(() => {
    if (!editing) return
    const controller = new AbortController()
    void meetingRequest<CalendarSetup>('setup', undefined, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setSetup(value)
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(messageOf(failure))
      })
    return () => controller.abort()
  }, [!!editing])

  useEffect(() => {
    if (!answered) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      const results = await Promise.allSettled(
        ids
          .split(',')
          .map((id) => meetingRequest<CalendarJob>(`jobs/${encodeURIComponent(id)}`, undefined, controller.signal)),
      )
      if (controller.signal.aborted) return
      const found: CalendarJob[] = results.flatMap((result, index) =>
        result.status === 'fulfilled'
          ? [result.value]
          : settled && result.reason?.status === 404
            ? [
                {
                  id: ids.split(',')[index]!,
                  state: 'uncertain' as const,
                  message: 'Sky has no saved result for this request. Check Calendar before trying again.',
                },
              ]
            : [],
      )
      setJobs((previous) => ({ ...previous, ...Object.fromEntries(found.map((job) => [job.id, job])) }))
      const lost = results.some((result) => result.status === 'rejected' && !(result.reason?.status === 404))
      setReceiptError(lost ? 'Waiting to reconnect to the calendar service. This will check the existing request.' : '')
      if (found.length < results.length || found.some((job) => job.state === 'creating'))
        timer = setTimeout(() => void poll(), 2000)
    }
    void poll()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [answered, ids, settled, pollRevision])

  useEffect(() => {
    const refresh = () => setPollRevision((value) => value + 1)
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [])

  const act = async (run: () => Promise<void>) => {
    if (working.current) return
    working.current = true
    setBusy(true)
    setError('')
    try {
      await run()
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      working.current = false
      setBusy(false)
    }
  }
  const save = () =>
    act(async () => {
      if (!ready || !chatId) return
      const response = await fetch(
        `/chat/${encodeURIComponent(chatId)}/approvals/${encodeURIComponent(approval.id)}/calendar`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ revision: editRevision, drafts: edits.current }),
        },
      )
      const result = await response.json()
      if (!response.ok) throw new Error(result.message ?? 'Could not save the meeting edits.')
      onChange?.(result as Approval)
      setEditing(null)
    })
  const status =
    answered === false
      ? 'Not sent'
      : answered
        ? drafts.every((draft) => (jobs[draft.id] ?? draft.job)?.state === 'created')
          ? 'Created'
          : drafts.some((draft) => (jobs[draft.id] ?? draft.job)?.state === 'creating')
            ? drafts.length === 1 && activeDraft.fields.recurrence
              ? 'Creating series…'
              : 'Creating event…'
            : drafts.some((draft) => (jobs[draft.id] ?? draft.job)?.state === 'failed')
              ? 'Not created'
              : drafts.some((draft) => (jobs[draft.id] ?? draft.job)?.state === 'uncertain')
                ? 'Save unconfirmed'
                : 'Checking result…'
        : 'Review before sending'
  return (
    <section
      className="sky-writing-draft sky-calendar-draft"
      aria-label={drafts.length > 1 ? 'Meeting drafts' : 'Meeting draft'}
    >
      <header className="sky-writing-draft-head">
        <div>
          <strong>{drafts.length > 1 ? `Meeting drafts · ${drafts.length}` : 'Meeting draft'}</strong>
          <span aria-live="polite">{status}</span>
        </div>
        {!editing && (
          <button className="sky-ctl" type="button" aria-pressed={raw} onClick={() => setRaw((value) => !value)}>
            {raw ? 'Preview' : 'Raw'}
          </button>
        )}
      </header>
      {raw ? (
        <pre className="sky-calendar-raw">{approval.lines.join('\n\n')}</pre>
      ) : (
        <>
          {drafts.length > 1 && (
            <div className="sky-calendar-batch">
              <p>{drafts.length} separate events. Select a date to review its details.</p>
              <div className="sky-calendar-dates" role="group" aria-label="Events in this request">
                {drafts.map((draft, index) => {
                  const job = jobs[draft.id] ?? draft.job
                  const result = batchStatus(draft, job)
                  return (
                    <button
                      type="button"
                      key={draft.id}
                      aria-pressed={activeIndex === index}
                      aria-label={`Review event ${index + 1}: ${draft.fields.title} on ${draft.fields.date}`}
                      disabled={!!editing || busy}
                      onClick={() => {
                        setSelected(index)
                      }}
                    >
                      <span>
                        {!sharedTitle && <strong>{draft.fields.title}</strong>}
                        <span>{meetingDayLabel(draft.fields.date)}</span>
                        <span className="sky-calendar-date-time">
                          {meetingClock(draft.fields.time)} · {draft.fields.duration} min
                        </span>
                      </span>
                      <span
                        className="sky-calendar-date-status"
                        data-warning={!['Clear', 'Created', 'Creating…'].includes(result) || undefined}
                      >
                        {result}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
          {(editing ?? [activeDraft]).map((draft) => (
            <div className="sky-calendar-event" key={draft.id}>
              {editing && editable ? (
                <MeetingEditor
                  saved={draft}
                  accounts={setup?.accounts ?? []}
                  busy={busy}
                  onChange={(edit) => {
                    edits.current[activeIndex] = edit
                    setReady(edits.current.length === drafts.length && edits.current.every(Boolean))
                  }}
                />
              ) : (
                <MeetingPreview
                  draft={draft}
                  summary={approval.lines[activeIndex]}
                  created={(jobs[draft.id] ?? draft.job)?.state === 'created'}
                />
              )}
              {answered && <MeetingReceipt draft={draft} job={jobs[draft.id] ?? draft.job} />}
            </div>
          ))}
        </>
      )}
      {editing && setup && !setup.accounts.length && (
        <p className="sky-calendar-error">
          Connect a Google account in <a href="/settings/connections">Settings → Connections</a> to schedule this event.
        </p>
      )}
      {editable && (
        <div className="sky-writing-draft-actions sky-calendar-actions">
          {editing ? (
            <>
              <Button
                variant="primary"
                size="sm"
                loading={busy}
                disabled={!ready || approval.revision !== editRevision}
                onClick={() => void save()}
              >
                Save changes
              </Button>
              <Button
                size="sm"
                disabled={busy}
                onClick={() => {
                  setEditing(null)
                  setError('')
                }}
              >
                Cancel edit
              </Button>
              {approval.revision !== editRevision && (
                <p role="alert">This draft changed in another window. Cancel this edit to review the latest version.</p>
              )}
            </>
          ) : (
            <>
              <Button
                size="sm"
                variant={conflicts ? 'warning' : 'primary'}
                loading={busy}
                onClick={() =>
                  void act(async () => {
                    await onAnswer!(true, false, approval.revision)
                  })
                }
              >
                {drafts.length > 1
                  ? guests
                    ? `Create ${drafts.length} events & send invites`
                    : `Create ${drafts.length} events`
                  : guests
                    ? drafts[0]?.fields.recurrence
                      ? 'Create series & send invites'
                      : 'Create & send invites'
                    : drafts[0]?.fields.recurrence
                      ? 'Create series'
                      : 'Create event'}
              </Button>
              {chatId && onChange && (
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    edits.current = drafts.map((draft) => ({
                      id: draft.id,
                      fields: draft.fields,
                      reviewKey: draft.reviewKey,
                    }))
                    edits.current[activeIndex] = null
                    setReady(false)
                    setError('')
                    setRaw(false)
                    setSetup(null)
                    setEditRevision(approval.revision ?? 0)
                    setEditing([activeDraft])
                  }}
                >
                  Edit
                </Button>
              )}
              <Button
                size="sm"
                disabled={busy}
                onClick={() => void act(() => onAnswer!(false, false, approval.revision))}
              >
                Not now
              </Button>
            </>
          )}
        </div>
      )}
      {error && (
        <p className="sky-calendar-error" role="alert">
          {error}
        </p>
      )}
      {receiptError && (
        <p className="sky-calendar-error" role="status">
          {receiptError}
        </p>
      )}
    </section>
  )
}
