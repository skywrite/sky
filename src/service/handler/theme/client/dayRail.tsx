import { Button, FileButton } from '@mantine/core'
import { type DragEvent, Fragment, type ReactNode, useEffect, useState } from 'react'
import type { DayData, ThreadSummary } from './day.tsx'
import { fileHref } from './explorer.tsx'
import { filesHref, type Kept, moveIn, readListing } from './files.tsx'
import { type ImportJob, importStateWord, type MeetingImport, useFileDrop } from './import.tsx'
import { RailToggle } from './railToggle.tsx'

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

function Section({
  title,
  count,
  children,
  drop,
  extra,
}: {
  title: string
  count?: number
  children: ReactNode
  drop?: ReturnType<typeof useFileDrop>
  /** At the heading's right edge */
  extra?: ReactNode
}) {
  return (
    <section
      className="sky-rail-sec"
      data-section={title.toLowerCase().replace(/\s+/g, '-')}
      data-meetings-drop={drop ? true : undefined}
      data-dragging={drop?.dragging || undefined}
      {...drop?.handlers}
    >
      <h2 className="sky-rail-sec-h">
        <span>{title}</span>
        {count !== undefined && count > 0 ? <span className="sky-rail-count">{count}</span> : null}
        {extra}
      </h2>
      {children}
    </section>
  )
}

function MeetingRow({
  meeting: m,
  ymd,
  onImportMeeting,
}: {
  meeting: ScheduledMeeting
  ymd: string
  onImportMeeting?: (files: File[], meeting: MeetingImport) => void
}) {
  const canDrop = Boolean(onImportMeeting && m.state === 'past' && !m.record && !m.allDay && m.start)
  const drop = useFileDrop(canDrop, (files) => onImportMeeting?.(files, { title: m.title, when: `${ymd} ${m.start}` }))
  return (
    <div
      className="sky-dr-item"
      data-state={m.state}
      data-meeting-drop={canDrop || undefined}
      data-dragging={drop.dragging || undefined}
      title={canDrop ? 'Drop a transcript or recording to import this meeting' : undefined}
      {...drop.handlers}
    >
      <span className="sky-dr-time">{m.allDay ? 'all day' : m.start}</span>
      <span className="sky-dr-label">{m.title || '(untitled)'}</span>
      <span className="sky-dr-mark">
        {drop.dragging ? (
          'drop to import'
        ) : m.state === 'past' ? (
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
  )
}

function ScheduleSection({
  schedule,
  ymd,
  onImportMeeting,
}: {
  schedule: DaySchedule | null
  ymd: string
  onImportMeeting?: (files: File[], meeting: MeetingImport) => void
}) {
  const drop = useFileDrop(Boolean(onImportMeeting), (files) => onImportMeeting?.(files, { day: ymd }))
  return (
    <Section title="Meetings" count={schedule?.meetings.length} drop={onImportMeeting ? drop : undefined}>
      {schedule && !schedule.read && <p className="sky-rail-empty">Calendar not read.</p>}
      {schedule?.read && schedule.meetings.length === 0 && <p className="sky-rail-empty">No meetings.</p>}
      {schedule?.meetings.map((m, i) => (
        <Fragment key={`${ymd}-${m.start}-${i}`}>
          <MeetingRow meeting={m} ymd={ymd} onImportMeeting={onImportMeeting} />
        </Fragment>
      ))}
    </Section>
  )
}

/** A live thread's word for the rail's right column. */
function threadWord(thread: ThreadSummary): string {
  return thread.state === 'new' || thread.state === 'done' ? 'live' : thread.state
}

/**
 * The day's chats: the ones filed under it and the live threads that
 * started on it, each branch under the chat it left. A saved chat opens
 * as a thread to continue; a live one is opened as it is. A live thread
 * that continues a saved chat stands in for the file, so the two never
 * list twice.
 */
function ChatsSection({
  ymd,
  chats,
  threads,
  onOpenThread,
  onOpenSaved,
}: {
  ymd: string
  chats: DayData['chats']
  threads: ThreadSummary[]
  onOpenThread: (id: string) => void
  onOpenSaved: (chat: string) => void
}) {
  // The day's own live threads: the ones that started on it, the day's own conversation aside.
  const live = threads.filter((t) => t.day === ymd && !t.id.startsWith('day-'))
  const continued = new Set(live.map((t) => t.saved).filter((s): s is string => s !== null))
  const saved = chats.filter((c) => !continued.has(c.path))
  const total = saved.length + live.length
  if (total === 0) {
    return (
      <Section title="Chats">
        <p className="sky-rail-empty">No chats yet.</p>
      </Section>
    )
  }
  const savedRow = (c: DayData['chats'][number], branch: boolean) => (
    <div className="sky-dr-item" data-branch={branch || undefined} key={c.path}>
      <span className="sky-dr-time">{c.time}</span>
      <button type="button" className="sky-dr-label sky-dr-open" onClick={() => onOpenSaved(c.path)}>
        {c.summary || c.path}
      </button>
      <span className="sky-dr-mark">
        {branch && c.parent ? `from turn ${c.parent.turn}` : `${c.exchanges} turn${c.exchanges === 1 ? '' : 's'}`}
      </span>
    </div>
  )
  const liveRow = (t: ThreadSummary, branch: boolean) => (
    <div className="sky-dr-item" data-live="true" data-branch={branch || undefined} key={t.id}>
      <span className="sky-dr-time">{t.when ?? ''}</span>
      <button type="button" className="sky-dr-label sky-dr-open" onClick={() => onOpenThread(t.id)}>
        {t.title ?? (t.parent ? 'New branch' : 'New chat')}
      </button>
      <span className="sky-dr-mark">{branch && t.parent ? `from turn ${t.parent.turn}` : threadWord(t)}</span>
    </div>
  )
  // Roots first, each with its branches beneath: saved branches by the parent's path, live ones by the parent's id or path.
  const savedRoots = saved.filter((c) => !c.parent || !saved.some((o) => o.path === c.parent?.chat))
  const liveRoots = live.filter(
    (t) => !t.parent || !(live.some((o) => o.id === t.parent?.id) || saved.some((c) => c.path === t.parent?.chat)),
  )
  return (
    <Section title="Chats" count={total}>
      {savedRoots.map((c) => (
        <Fragment key={c.path}>
          {savedRow(c, false)}
          {saved.filter((b) => b.parent?.chat === c.path).map((b) => savedRow(b, true))}
          {live.filter((t) => t.parent?.chat === c.path && !t.parent.id).map((t) => liveRow(t, true))}
        </Fragment>
      ))}
      {liveRoots.map((t) => (
        <Fragment key={t.id}>
          {liveRow(t, false)}
          {live.filter((b) => b.parent?.id === t.id).map((b) => liveRow(b, true))}
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

/** How many folders and files the day keeps, for the heading; re-counted after each keep. */
function useDayFileCount(ymd: string, version: number): number {
  const [count, setCount] = useState(0)
  useEffect(() => {
    let alive = true
    readListing(ymd)
      .then((listing) => alive && setCount(listing.folders.length + listing.files.length))
      .catch(() => alive && setCount(0))
    return () => {
      alive = false
    }
  }, [ymd, version])
  return count
}

/**
 * The pad at the foot of the rail: a file dropped or chosen here is kept
 * with the day — the original moves in when this Mac has it, else a copy
 * lands — and the toast says what happened and holds Undo. The pad lists
 * nothing; the heading counts what the day keeps, and Browse opens the
 * day's files as a page.
 */
function AttachmentsPad({ ymd, onKept }: { ymd: string; onKept: (kept: Kept[]) => void }) {
  const [over, setOver] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [kept, setKeptCount] = useState(0)
  const count = useDayFileCount(ymd, kept)
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
    if (kept.length > 0) {
      onKept(kept)
      setKeptCount((n) => n + 1)
    }
  }
  const drop = (event: DragEvent) => {
    if (!hasFiles(event)) return
    event.preventDefault()
    setOver(0)
    void keep(event.dataTransfer ? Array.from(event.dataTransfer.files) : [])
  }
  return (
    <div className="sky-rail-foot">
      <Section
        title="File Attachments"
        count={count}
        extra={
          <a className="sky-rail-browse" href={filesHref(ymd)}>
            Browse
          </a>
        }
      >
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
  onOpenSaved,
  onOpenImport,
  onImportMeeting,
  onKept,
  onToggle,
}: {
  ymd: string
  /** Chats filed under the day */
  chats: DayData['chats']
  /** Every live thread; the rail keeps the ones that started on this day */
  threads: ThreadSummary[]
  /** Imports, when the day is today */
  imports: ImportJob[]
  onOpenThread: (id: string) => void
  /** A saved chat, by its notebook-relative path, opened to continue */
  onOpenSaved: (chat: string) => void
  onOpenImport: (id: string) => void
  onImportMeeting?: (files: File[], meeting: MeetingImport) => void
  /** Files the pad kept — the toast's words, and what Undo reverses */
  onKept: (kept: Kept[]) => void
  /** Folds the rail away — the chevron in its corner */
  onToggle: () => void
}) {
  const schedule = useSchedule(ymd)
  return (
    <aside className="sky-rail" data-day="" aria-label="Details">
      <div className="sky-rail-head">
        <RailToggle open onClick={onToggle} />
      </div>
      <div className="sky-rail-body">
        <ScheduleSection schedule={schedule} ymd={ymd} onImportMeeting={onImportMeeting} />
        <ChatsSection ymd={ymd} chats={chats} threads={threads} onOpenThread={onOpenThread} onOpenSaved={onOpenSaved} />
        <WorkingSection imports={imports} onOpenImport={onOpenImport} />
      </div>
      <AttachmentsPad ymd={ymd} onKept={onKept} />
    </aside>
  )
}
