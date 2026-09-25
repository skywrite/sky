import './dayEnd.css'
import { Button, Drawer, Modal } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { Fragment, useEffect, useRef, useState } from 'react'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { clock, type DayData, type DayItem, Tick } from './day.tsx'
import { useSchedule } from './dayRail.tsx'
import { fileHref } from './explorer.tsx'

/**
 * Ending a day from the page: End asks first. The dialog names what the
 * plan still holds open, so a finished item can be ticked on the way out,
 * and the meetings missing an end time or notes. Pressing End runs the
 * terminal's day:end at that moment.
 */

/** What the service shows before a day ends. */
interface DayEnding {
  /** Meeting and event records that state no end time */
  endless: Array<{ start: string; title: string; path: string }>
}

/** The lock the ended badge wears, on the button that locks the day. */
export function LockIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <rect x="5" y="10" width="14" height="11" rx="2.5" />
        <path d="M8 10V7a4 4 0 1 1 8 0v3M12 14.5v2.5" />
      </g>
    </svg>
  )
}

/** Everything the plan still holds open — what an ended day records as not done. */
export function openItems(record: DayData['record']): DayItem[] {
  return [...record.mostImportant, ...record.commitments, ...record.todos, ...record.reminders].filter(
    (item) => !item.done,
  )
}

/** One item's identity across a check-off: its list and its words, strike marks aside. */
const keyOf = (item: DayItem) => `${item.list}\n${item.text}`

/** A write that answers with the day's fresh view, or the reason it did not land. */
async function send(route: string, body: unknown): Promise<{ view: DayData | null; error: string | null }> {
  try {
    const response = await fetch(route, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = (await response.json().catch(() => null)) as (DayData & { error?: string; view?: DayData }) | null
    if (!response.ok || !json || json.error)
      return { view: json?.view ?? null, error: json?.error ?? `That did not go through (${response.status}).` }
    return { view: json, error: null }
  } catch {
    return { view: null, error: 'The service did not answer.' }
  }
}

function OpenRow({ item, done, onTick }: { item: DayItem; done: boolean; onTick: (() => void) | null }) {
  return (
    <div className="sky-end-row" data-done={done || undefined}>
      {onTick ? (
        <button
          type="button"
          className="sky-check"
          aria-label={done ? `Mark not done: ${item.text}` : `Mark done: ${item.text}`}
          aria-pressed={done}
          onClick={onTick}
        >
          <span className="sky-check-box" data-on={done}>
            {done && <Tick />}
          </span>
        </button>
      ) : (
        <span className="sky-check-static" role="img" aria-label={done ? 'Complete' : 'Incomplete'}>
          <span className="sky-check-box" data-on={done}>
            {done && <Tick />}
          </span>
        </span>
      )}
      {item.time && <span className="sky-when">{clock(item.time)}</span>}
      <span className="sky-ptext">{item.text}</span>
      {item.category === 'Personal' && <span className="sky-pchip">Personal</span>}
    </div>
  )
}

export function EndDayDialog({
  ymd,
  view: shown,
  onView,
  onClose,
  onEnded,
}: {
  ymd: string
  /** The day as its page shows it; the dialog reads it itself when opened elsewhere */
  view?: DayData | null
  /** A tick or the end answered with the day's fresh view */
  onView?: (view: DayData) => void
  onClose: () => void
  onEnded?: (view: DayData) => void
}) {
  const phone = useMediaQuery('(max-width: 900px)') ?? false
  const [view, setView] = useState<DayData | null>(shown ?? null)
  const [ending, setEnding] = useState<DayEnding | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const schedule = useSchedule(ymd)
  // The open items as the dialog opened: a tick shows as done without the row leaving.
  const listed = useRef<DayItem[] | null>(null)

  useEffect(() => {
    let alive = true
    fetch(`/day/${ymd}/end`)
      .then((r) => r.json())
      .then((body) => alive && setEnding(body as DayEnding))
      .catch(() => alive && setError('The service did not answer.'))
    if (!shown)
      fetch(`/day/${ymd}`)
        .then((r) => r.json())
        .then((body) => alive && setView(body as DayData))
        .catch(() => alive && setError('The service did not answer.'))
    return () => {
      alive = false
    }
  }, [ymd])

  if (view && listed.current === null) listed.current = openItems(view.record)
  const current = new Map<string, DayItem>(
    (view ? [...openItems(view.record), ...doneItems(view.record)] : []).map((item) => [keyOf(item), item]),
  )
  // A completed reminder leaves the plan: gone from the fresh view means done, and it stays done.
  const rows = (listed.current ?? []).map((item) => {
    const present = current.get(keyOf(item))
    return { item, done: present ? present.done : true, present: Boolean(present) }
  })
  const stillOpen = rows.filter((row) => !row.done).length
  const weekday = new PlainDate(ymd).dayLong
  const started = view?.record.started ?? null
  const noNotes = (schedule?.meetings ?? []).filter((m) => m.state === 'past' && !m.record && !m.allDay)

  const apply = (fresh: DayData) => {
    setView(fresh)
    onView?.(fresh)
  }

  const tick = async (item: DayItem, done: boolean) => {
    setBusy(keyOf(item))
    setError(null)
    // The original line, unstruck: the item route matches with strike marks ignored.
    const result = await send(`/day/${ymd}/item`, { list: item.list, raw: item.raw, done })
    if (result.view) apply(result.view)
    if (result.error) setError(result.error)
    setBusy(null)
  }

  const end = async () => {
    setBusy('end')
    setError(null)
    const result = await send(`/day/${ymd}/end`, {})
    setBusy(null)
    if (result.view) apply(result.view)
    if (result.error) return setError(result.error)
    if (result.view) onEnded?.(result.view)
    onClose()
  }

  const body = (
    <div className={`sky-confirm sky-end${phone ? ' sky-sheet' : ''}`}>
      {phone && <div className="sky-sheet-handle" />}
      <div className="sky-confirm-title" tabIndex={-1} data-autofocus>
        End {weekday}?
      </div>
      <div className="sky-confirm-file">
        {view ? view.day.dateLabel.replace(/^[A-Za-z]+, /, '') : ''}
        {started ? ` · started ${clock(started)}` : ''}
      </div>
      {view && rows.length > 0 && (
        <div className="sky-end-section">
          <span className="sky-choice-label">Still open</span>
          <div className="sky-end-list">
            {rows.map(({ item, done, present }) => (
              <Fragment key={keyOf(item)}>
                <OpenRow
                  item={item}
                  done={done}
                  onTick={!present || item.workstream || busy !== null ? null : () => void tick(item, !done)}
                />
              </Fragment>
            ))}
          </div>
          <div className="sky-end-note">Tick anything you finished. The rest stays on the record as not done.</div>
        </div>
      )}
      {view && stillOpen === 0 && (
        <div className="sky-end-perfect">
          <span className="sky-check-box" data-on>
            <Tick />
          </span>
          Everything is done. This will be a perfect day.
        </div>
      )}
      {((ending?.endless.length ?? 0) > 0 || noNotes.length > 0) && (
        <div className="sky-end-section">
          <span className="sky-choice-label">Meetings</span>
          {ending?.endless.map((record) => (
            <div className="sky-end-flag" key={record.path}>
              <span>
                {record.title} at {clock(record.start)} has no end time.
              </span>
              <a className="sky-confirm-link" href={fileHref(record.path)}>
                Open it
              </a>
            </div>
          ))}
          {noNotes.map((meeting) => (
            <div className="sky-end-flag" key={`${meeting.start}-${meeting.title}`}>
              <span>
                {meeting.title || 'A meeting'} at {clock(meeting.start)} is on your calendar but has no notes.
              </span>
            </div>
          ))}
        </div>
      )}
      {error && (
        <div className="sky-confirm-read sky-end-error" role="alert">
          {error}
        </div>
      )}
      <div className="sky-dialog-actions">
        <Button onClick={onClose} disabled={busy === 'end'}>
          Not yet
        </Button>
        <Button
          variant="primary"
          leftSection={<LockIcon />}
          loading={busy === 'end'}
          disabled={busy !== null && busy !== 'end'}
          onClick={() => void end()}
        >
          End {weekday}
        </Button>
      </div>
    </div>
  )

  return phone ? (
    <Drawer opened onClose={onClose} position="bottom" size="auto" withCloseButton={false}>
      {body}
    </Drawer>
  ) : (
    <Modal opened onClose={onClose} centered size={560} withCloseButton={false}>
      {body}
    </Modal>
  )
}

/** The plan's items already done — where a ticked row is found again in the fresh view. */
function doneItems(record: DayData['record']): DayItem[] {
  return [...record.mostImportant, ...record.commitments, ...record.todos, ...record.reminders].filter(
    (item) => item.done,
  )
}
