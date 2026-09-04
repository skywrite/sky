import { Button, FileButton } from '@mantine/core'
import { type DragEvent, Fragment, type ReactNode, useEffect, useState } from 'react'
import type { DayData, ThreadSummary } from './day.tsx'
import { fileHref } from './explorer.tsx'
import { type Kept, moveIn } from './files.tsx'
import { type ImportJob, importStateWord } from './import.tsx'

/**
 * The rail beside a day: what is around the day rather than in its
 * record — the calendar's schedule, the day's chats, work in progress,
 * and a pad to attach files. Drawn the way a document's Details rail is
 * drawn, so the two read alike. The record itself stays in the column.
 */

// -----------------------------------------------------------------------------
// The schedule, as the service answers it
// -----------------------------------------------------------------------------

export interface ScheduledMeeting {
  title: string
  /** `HH:MM`; empty for an all-day event */
  start: string
  end: string
  allDay: boolean
  /** The other people, names or addresses */
  who: string[]
  joinUrl: string | null
  state: 'past' | 'now' | 'next'
  /** The notebook's record of it, when one is filed */
  record: { path: string; title: string } | null
}

export interface DaySchedule {
  /** Whether the calendar answered; false leaves `meetings` empty */
  read: boolean
  errors: string[]
  meetings: ScheduledMeeting[]
}

const SCHEDULE_MS = 60_000

/** The day's schedule, re-read every minute so "now" moves; null until the first answer. */
export function useSchedule(ymd: string | null): DaySchedule | null {
  const [schedule, setSchedule] = useState<DaySchedule | null>(null)
  useEffect(() => {
    setSchedule(null)
    if (!ymd) return
    let alive = true
    const read = () =>
      fetch(`/day/${ymd}/schedule`)
        .then((r) => (r.ok ? r.json() : { read: false, errors: [], meetings: [] }))
        .then((body) => alive && setSchedule(body as DaySchedule))
        .catch(() => alive && setSchedule({ read: false, errors: [], meetings: [] }))
    void read()
    const timer = setInterval(read, SCHEDULE_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [ymd])
  return schedule
}

// -----------------------------------------------------------------------------
// Words
// -----------------------------------------------------------------------------

const NAMED = 2

/** `Jane Doe, Alex Chen, 4 more` — the first names in full, the rest counted. */
function whoLine(who: string[]): string {
  if (who.length <= NAMED + 1) return who.join(', ')
  return `${who.slice(0, NAMED).join(', ')}, ${who.length - NAMED} more`
}

function minutesOf(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

/** `30 min`, `1 h`, `1 h 15 min` — a meeting's length. */
function lengthWords(start: string, end: string): string {
  const total = minutesOf(end) - minutesOf(start)
  if (!(total > 0)) return ''
  const hours = Math.floor(total / 60)
  const mins = total % 60
  if (hours === 0) return `${mins} min`
  return mins > 0 ? `${hours} h ${mins} min` : `${hours} h`
}

// -----------------------------------------------------------------------------
// Sections
// -----------------------------------------------------------------------------

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="sky-rail-sec" data-section={title.toLowerCase().replace(/\s+/g, '-')}>
      <h2 className="sky-rail-sec-h">
        <span>{title}</span>
        {count !== undefined && count > 0 ? <span className="sky-rail-count">{count}</span> : null}
      </h2>
      {children}
    </section>
  )
}

function ScheduleSection({ schedule }: { schedule: DaySchedule | null }) {
  if (!schedule) return <Section title="Schedule">{null}</Section>
  if (!schedule.read) {
    return (
      <Section title="Schedule">
        <p className="sky-rail-empty">Calendar not read.</p>
      </Section>
    )
  }
  if (schedule.meetings.length === 0) {
    return (
      <Section title="Schedule">
        <p className="sky-rail-empty">Nothing on the calendar.</p>
      </Section>
    )
  }
  return (
    <Section title="Schedule" count={schedule.meetings.length}>
      {schedule.meetings.map((m, i) => (
        <Fragment key={`${m.start}-${i}`}>
          <div className="sky-dr-item" data-state={m.state}>
            <span className="sky-dr-time">{m.allDay ? 'all day' : m.start}</span>
            <span className="sky-dr-label">{m.title || '(untitled)'}</span>
            <span className="sky-dr-mark">
              {m.state === 'past' ? (
                m.record ? (
                  <a href={fileHref(m.record.path)}>filed</a>
                ) : (
                  'no record'
                )
              ) : m.state === 'now' ? (
                m.joinUrl ? (
                  <a href={m.joinUrl} target="_blank" rel="noopener noreferrer">
                    join
                  </a>
                ) : (
                  'now'
                )
              ) : (
                lengthWords(m.start, m.end)
              )}
            </span>
            {(m.who.length > 0 || m.state === 'now') && (
              <span className="sky-dr-who">
                {[whoLine(m.who), m.state === 'now' && !m.allDay ? `until ${m.end}` : ''].filter(Boolean).join(' · ')}
              </span>
            )}
          </div>
        </Fragment>
      ))}
    </Section>
  )
}

/** A live thread's word for the rail's right column. */
function threadWord(thread: ThreadSummary): string {
  return thread.state === 'new' || thread.state === 'done' ? 'live' : thread.state
}

function ChatsSection({
  ymd,
  chats,
  threads,
  onOpenThread,
}: {
  ymd: string
  chats: DayData['chats']
  threads: ThreadSummary[]
  onOpenThread: (id: string) => void
}) {
  // The day's own live threads: the ones that started on it, the day's own conversation aside.
  const live = threads.filter((t) => t.day === ymd && !t.id.startsWith('day-'))
  const total = chats.length + live.length
  if (total === 0) {
    return (
      <Section title="Chats">
        <p className="sky-rail-empty">No chats yet.</p>
      </Section>
    )
  }
  return (
    <Section title="Chats" count={total}>
      {chats.map((c) => (
        <Fragment key={c.path}>
          <div className="sky-dr-item">
            <span className="sky-dr-time">{c.time}</span>
            <span className="sky-dr-label">
              <a href={fileHref(c.path)}>{c.summary || c.path}</a>
            </span>
            <span className="sky-dr-mark">
              {c.exchanges} turn{c.exchanges === 1 ? '' : 's'}
            </span>
          </div>
        </Fragment>
      ))}
      {live.map((t) => (
        <Fragment key={t.id}>
          <div className="sky-dr-item" data-live="true">
            <span className="sky-dr-time">{t.when ?? ''}</span>
            <button type="button" className="sky-dr-label sky-dr-open" onClick={() => onOpenThread(t.id)}>
              {t.title ?? 'New chat'}
            </button>
            <span className="sky-dr-mark">
              {[t.saves === false ? 'not saved' : null, threadWord(t)].filter(Boolean).join(' · ')}
            </span>
          </div>
        </Fragment>
      ))}
    </Section>
  )
}

/**
 * Imports still in hand: running, waiting on the person, or stopped where a
 * start could pick them up. A filed one is on the day already, and a file
 * sky refused was never work — neither is anyone's to do.
 */
export function inHand(job: ImportJob): boolean {
  if (job.readback.refusal) return false
  return job.state === 'running' || job.state === 'needs-you' || job.state === 'failed'
}

function WorkingSection({ imports, onOpenImport }: { imports: ImportJob[]; onOpenImport: (id: string) => void }) {
  const jobs = imports.filter(inHand)
  if (jobs.length === 0) return null
  return (
    <Section title="Working" count={jobs.length}>
      {jobs.map((j) => (
        <Fragment key={j.id}>
          <div className="sky-dr-work" data-state={j.state}>
            <span className="sky-dr-work-txt">
              {j.title}
              <span className="sky-dr-work-line">{j.line ?? importStateWord(j)}</span>
            </span>
            {j.state === 'needs-you' ? (
              <Button size="compact-xs" variant="light" color="blue" onClick={() => onOpenImport(j.id)}>
                Review
              </Button>
            ) : (
              <Button size="compact-xs" onClick={() => onOpenImport(j.id)}>
                Open
              </Button>
            )}
          </div>
        </Fragment>
      ))}
    </Section>
  )
}

/**
 * The pad at the foot of the rail: a file dropped or chosen here is kept
 * with the day — the original moves in when this Mac has it, else a copy
 * lands — and the toast says what happened and holds Undo. The pad lists
 * nothing: the day's directory is the explorer's to show.
 */
function AttachmentsPad({ ymd, onKept }: { ymd: string; onKept: (kept: Kept[]) => void }) {
  const [over, setOver] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files')
  const keep = async (files: File[]) => {
    if (files.length === 0 || busy) return
    const kept: Kept[] = []
    setProblem(null)
    try {
      for (const file of files) {
        setBusy(`Moving ${file.name}…`)
        kept.push(
          await moveIn(file, ymd, (fraction) => setBusy(`Copying ${file.name} · ${Math.round(fraction * 100)}%`)),
        )
      }
    } catch (err) {
      setProblem((err as Error).message)
    } finally {
      setBusy(null)
    }
    if (kept.length > 0) onKept(kept)
  }
  const drop = (event: DragEvent) => {
    if (!hasFiles(event)) return
    event.preventDefault()
    setOver(0)
    void keep(event.dataTransfer ? Array.from(event.dataTransfer.files) : [])
  }
  return (
    <div className="sky-rail-foot">
      <Section title="File Attachments">
        <div
          className="sky-rail-pad sky-dr-pad"
          data-drop-pad=""
          data-over={over > 0 ? '' : undefined}
          data-busy={busy ? '' : undefined}
          onDragEnter={(e) => hasFiles(e) && setOver((n) => n + 1)}
          onDragOver={(e) => hasFiles(e) && e.preventDefault()}
          onDragLeave={(e) => hasFiles(e) && setOver((n) => Math.max(0, n - 1))}
          onDrop={drop}
        >
          {busy ?? (
            <>
              <span className="sky-rail-drop-words">Drop a file here, or </span>
              <FileButton multiple onChange={(files) => void keep(files)}>
                {(props) => (
                  <button type="button" className="sky-rail-choose" {...props}>
                    choose files…
                  </button>
                )}
              </FileButton>
            </>
          )}
        </div>
        {problem ? <p className="sky-rail-problem">{problem}</p> : null}
      </Section>
    </div>
  )
}

// -----------------------------------------------------------------------------
// The rail
// -----------------------------------------------------------------------------

export function DayRail({
  ymd,
  chats,
  threads,
  imports,
  onOpenThread,
  onOpenImport,
  onKept,
  onClose,
}: {
  ymd: string
  /** Chats filed under the day */
  chats: DayData['chats']
  /** Every live thread; the rail keeps the ones that started on this day */
  threads: ThreadSummary[]
  /** Imports, when the day is today */
  imports: ImportJob[]
  onOpenThread: (id: string) => void
  onOpenImport: (id: string) => void
  /** Files the pad kept — the toast's words, and what Undo reverses */
  onKept: (kept: Kept[]) => void
  /** Set when the rail is an overlay that can be dismissed */
  onClose?: () => void
}) {
  const schedule = useSchedule(ymd)
  return (
    <aside className="sky-rail" data-day="" aria-label="Details">
      <div className="sky-rail-head">
        <span className="sky-rail-title">Details</span>
        {onClose ? (
          <button type="button" className="sky-rail-close" aria-label="Close details" onClick={onClose}>
            ×
          </button>
        ) : null}
      </div>
      <div className="sky-rail-body">
        <ScheduleSection schedule={schedule} />
        <ChatsSection ymd={ymd} chats={chats} threads={threads} onOpenThread={onOpenThread} />
        <WorkingSection imports={imports} onOpenImport={onOpenImport} />
      </div>
      <AttachmentsPad ymd={ymd} onKept={onKept} />
    </aside>
  )
}
