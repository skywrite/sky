import { Button } from '@mantine/core'
import { Fragment, type ReactNode, useEffect, useRef, useState } from 'react'
import { type Chat, Composer, type ComposerAttach, type Note, NoteLine, ThreadColumn, useFollow } from './chat.tsx'
import { DayRail } from './dayRail.tsx'
import { fileHref, resolvePath } from './explorer.tsx'
import { type Kept, KeptToast } from './files.tsx'
import { DropOverlay, type ImportJob } from './import.tsx'
import { useRail } from './rail.ts'
import { revealOpacity, useSwipeToDelete } from './swipe.ts'

/**
 * The day is the page. Its column is what needs to get done — with
 * checkboxes that write back to the day file — then the day so far, the
 * threads running inside it, and the day's own conversation. A checked
 * to-do slides into Done today; a checked reminder just leaves; an item
 * can also be taken off the day, by the × a hover shows or a swipe on the
 * phone. Undo holds the door for eight seconds whichever way a row left.
 */

// -----------------------------------------------------------------------------
// What the service knows about the day
// -----------------------------------------------------------------------------

export interface DayRef {
  ymd: string
  label: string
  meta: string
  dayRelativePath: string | null
}

export interface DayData {
  today: DayRef
  /** The day on the page — today unless a past day was asked for */
  day: DayRef & { dateLabel: string }
  days: DayRef[]
  section: {
    dateLabel: string
    dayRelativePath: string | null
    mostImportant: Array<{ label: string; relativePath: string }>
    streaks: Array<{ title: string; doneToday: boolean }>
  } | null
  chats: Array<{ path: string; time: string; summary: string; exchanges: number }>
  record: DayRecord
}

/** One bullet from the day file: a plan, a promise, or a thing done. */
export interface DayItem {
  text: string
  done: boolean
  category: string | null
  time: string | null
  link: { title: string; path: string } | null
  /** The exact list heading the item lives under — the write-back address */
  list: string
  /** The item exactly as stored — the write-back address */
  raw: string
}

export interface DayDocRow {
  title: string
  path: string
  when: string | null
  summary: string | null
}

export interface DayRecord {
  mostImportant: DayItem[]
  commitments: DayItem[]
  todos: DayItem[]
  reminders: DayItem[]
  done: DayItem[]
  meetings: Array<DayDocRow & { who: string | null }>
  messages: {
    involved: Array<DayDocRow & { from: string | null; to: string | null; medium: string | null }>
    archive: Array<DayDocRow & { from: string | null; to: string | null; medium: string | null }>
  }
  notes: DayDocRow[]
  journals: DayDocRow[]
  skipped: number
}

export type ThreadState = 'new' | 'reading' | 'thinking' | 'streaming' | 'waiting' | 'done' | 'failed' | 'saving'

export interface ThreadSummary {
  id: string
  title: string | null
  state: ThreadState
  line: string | null
  when: string | null
  /** The day the thread started, `YYYY-MM-DD` */
  day: string
  turns: number
  busy: boolean
  /** False for a thread that will not be kept */
  saves?: boolean
}

/** The day named by `ymd`, or today when null. */
export function useDay(ymd: string | null): DayData | null {
  const [day, setDay] = useState<DayData | null>(null)
  useEffect(() => {
    let alive = true
    setDay(null)
    fetch(ymd ? `/day/${ymd}` : '/day')
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => alive && setDay(body as DayData | null))
      .catch(() => alive && setDay(null))
    return () => {
      alive = false
    }
  }, [ymd])
  return day
}

/** The live threads, re-read every few seconds — the list is in memory on the service, so this is cheap. */
export function useThreads(): ThreadSummary[] {
  const [threads, setThreads] = useState<ThreadSummary[]>([])
  useEffect(() => {
    let alive = true
    const read = () =>
      fetch('/chat')
        .then((r) => (r.ok ? r.json() : { threads: [] }))
        .then((body) => alive && setThreads((body as { threads: ThreadSummary[] }).threads))
        .catch(() => {})
    void read()
    const timer = setInterval(read, 2500)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])
  return threads
}

// -----------------------------------------------------------------------------
// Checking things off
// -----------------------------------------------------------------------------

/** How long Undo holds the door. */
const UNDO_MS = 8000
/** Sorts untimed items after every timed one. */
const NO_TIME = 100000

/** Stable across the strike itself — the raw gains `~~` when checked, the key must not. */
function itemKey(item: DayItem): string {
  return `${item.list}\u0000${item.raw.replace(/~~/g, '').trim()}`
}

function minutesOf(time: string | null): number | null {
  const parts = /^(\d{1,2}):(\d{2})$/.exec(time ?? '')
  return parts ? Number(parts[1]) * 60 + Number(parts[2]) : null
}

/** `09:30` reads as `9:30`; ranges keep both ends readable. */
function clock(when: string): string {
  return when.replace(/\b0(\d:\d\d)/g, '$1')
}

/** Frontmatter says `slack`; the page says `Slack`. */
function mediumLabel(medium: string | null): string | null {
  return medium ? medium.charAt(0).toUpperCase() + medium.slice(1) : null
}

function currentMinutes(): number {
  const now = new Date()
  return now.getHours() * 60 + now.getMinutes()
}

/** A checked row shows its strike, then collapses; a deleted row only collapses. */
type ItemPhase = 'struck' | 'gone' | 'removed'

/** How a row left: checked off, a reminder cleared, or deleted */
type Leaving = 'done' | 'cleared' | 'deleted'

const UNDO_WORDS: Record<Leaving, string> = { done: 'Done', cleared: 'Reminder cleared', deleted: 'Deleted' }

interface UndoState {
  key: string
  list: string
  raw: string
  text: string
  how: Leaving
  /** Where a deleted item stood in its list — the address Undo puts it back at */
  at: number | null
}

interface CheckOff {
  phases: Record<string, ItemPhase>
  undo: UndoState | null
  check: (item: DayItem) => void
  /** Take an item off the day — the row's ×, or the phone's swipe */
  remove: (item: DayItem) => void
  revert: () => void
  /** Put a done item back — the Done today row's own un-check */
  uncheck: (item: DayItem) => void
}

/**
 * The checkbox flow: strike locally at once, write to the day file, and
 * let the row leave once both the animation and the write are done. The
 * file keeps everything — Undo just un-strikes. A delete is the same
 * shape without the strike: the row collapses, the line leaves the file,
 * and Undo puts it back where it was.
 */
function useCheckOff(ymd: string, applyView: (view: DayData) => void): CheckOff {
  const [phases, setPhases] = useState<Record<string, ItemPhase>>({})
  const [undo, setUndo] = useState<UndoState | null>(null)
  // A row unmounts only after the collapse has played AND the write came back.
  const gate = useRef<Record<string, { anim: boolean; resp: boolean }>>({})
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const dropPhase = (key: string) =>
    setPhases((p) => {
      if (!(key in p)) return p
      const next = { ...p }
      delete next[key]
      return next
    })

  const settle = (key: string, side: 'anim' | 'resp') => {
    const flags = (gate.current[key] ??= { anim: false, resp: false })
    flags[side] = true
    if (flags.anim && flags.resp) {
      delete gate.current[key]
      dropPhase(key)
    }
  }

  /** A write to the item routes; null when it did not land. */
  const send = async <T,>(route: string, body: unknown): Promise<T | null> => {
    try {
      const response = await fetch(`/day/${ymd}/item${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      return response.ok ? ((await response.json()) as T) : null
    } catch {
      return null
    }
  }
  const post = (list: string, raw: string, done: boolean) => send<DayData>('', { list, raw, done })

  const hold = (undo: UndoState) => {
    if (undoTimer.current) clearTimeout(undoTimer.current)
    setUndo(undo)
    undoTimer.current = setTimeout(() => setUndo(null), UNDO_MS)
  }

  const check = (item: DayItem) => {
    const key = itemKey(item)
    if (phases[key]) return
    gate.current[key] = { anim: false, resp: false }
    setPhases((p) => ({ ...p, [key]: 'struck' }))
    window.setTimeout(() => {
      setPhases((p) => (p[key] === 'struck' ? { ...p, [key]: 'gone' } : p))
      window.setTimeout(() => settle(key, 'anim'), 420)
    }, 650)
    void post(item.list, item.raw, true).then((view) => {
      if (!view) {
        // The write did not land — the row pops back untouched.
        delete gate.current[key]
        dropPhase(key)
        return
      }
      applyView(view)
      settle(key, 'resp')
      const how: Leaving = /^reminders$/i.test(item.list.trim()) ? 'cleared' : 'done'
      hold({ key, list: item.list, raw: item.raw, text: item.text, how, at: null })
    })
  }

  const remove = (item: DayItem) => {
    const key = itemKey(item)
    if (phases[key]) return
    setPhases((p) => ({ ...p, [key]: 'removed' }))
    // The row finishes collapsing before the view without it lands, so it never blinks out.
    const collapsed = new Promise<void>((done) => window.setTimeout(done, 380))
    const written = send<{ at: number; view: DayData }>('/delete', { list: item.list, raw: item.raw })
    void Promise.all([written, collapsed]).then(([result]) => {
      if (!result) {
        // The write did not land — the row pops back untouched.
        dropPhase(key)
        return
      }
      applyView(result.view)
      dropPhase(key)
      hold({ key, list: item.list, raw: item.raw, text: item.text, how: 'deleted', at: result.at })
    })
  }

  const revert = () => {
    const held = undo
    if (!held) return
    if (undoTimer.current) clearTimeout(undoTimer.current)
    setUndo(null)
    const back =
      held.how === 'deleted'
        ? send<DayData>('/restore', { list: held.list, raw: held.raw, at: held.at })
        : post(held.list, held.raw, false)
    void back.then((view) => {
      delete gate.current[held.key]
      dropPhase(held.key)
      if (view) applyView(view)
    })
  }

  const uncheck = (item: DayItem) => {
    const key = itemKey(item)
    delete gate.current[key]
    dropPhase(key)
    // If this very item's undo pill is up, this IS the undo — take the pill down with it.
    setUndo((held) => {
      if (held && held.key === key) {
        if (undoTimer.current) clearTimeout(undoTimer.current)
        return null
      }
      return held
    })
    void post(item.list, item.raw, false).then((view) => {
      if (view) applyView(view)
    })
  }

  return { phases, undo, check, remove, revert, uncheck }
}

// -----------------------------------------------------------------------------
// Rendering
// -----------------------------------------------------------------------------

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

function Tick() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M2.5 7.5L5.5 10.5L11.5 3.5"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function Cross() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M2.5 2.5L9.5 9.5M9.5 2.5L2.5 9.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function Block({ head, mini, children }: { head: string; mini?: string; children: ReactNode }) {
  return (
    <div className="sky-block">
      <div className="sky-block-head sky-bhead">
        {head}
        <span className="sky-spacer" />
        {mini && <span className="sky-count">{mini}</span>}
      </div>
      <div className="sky-block-pad">{children}</div>
    </div>
  )
}

/**
 * One plan item: checkbox, its time when the list is timed, the text,
 * Personal when it's the exception — and the way off the day: an × right
 * after the text, shown on hover, or on the phone a swipe left that bares
 * Delete.
 */
function PlanRow({
  item,
  phase,
  timed,
  tone,
  chip,
  soft,
  at,
  onCheck,
  onDelete,
}: {
  item: DayItem
  phase: ItemPhase | undefined
  /** Render the time gutter (the card has timed items) */
  timed: boolean
  /** 'next' | 'late' | undefined — today's emphasis on the time */
  tone: 'next' | 'late' | undefined
  /** Mark Personal — only in lists that mix categories */
  chip: boolean
  /** The lighter reminder voice */
  soft: boolean
  at: string
  onCheck: (item: DayItem) => void
  onDelete: (item: DayItem) => void
}) {
  const struck = item.done || phase === 'struck' || phase === 'gone'
  const swipe = useSwipeToDelete(() => onDelete(item))
  // A row whose write did not land stands where it was — slid back if it had gone.
  useEffect(() => {
    if (!phase) swipe.close()
  }, [phase])
  return (
    <div className="sky-prow sky-irow" data-phase={phase} data-soft={soft || undefined} ref={swipe.ref}>
      {swipe.offset < 0 && (
        <div className="sky-irow-back" style={{ width: -swipe.offset }}>
          <button
            type="button"
            className="sky-irow-delete"
            style={{ opacity: revealOpacity(swipe.offset) }}
            tabIndex={swipe.open ? 0 : -1}
            onClick={swipe.commit}
          >
            Delete
          </button>
        </div>
      )}
      <div
        className="sky-irow-front"
        data-dragging={swipe.dragging || undefined}
        style={swipe.offset ? { transform: `translateX(${swipe.offset}px)` } : undefined}
        onClickCapture={(event) => {
          // A tap on an open row puts it back; nothing under the finger fires.
          if (!swipe.open) return
          event.preventDefault()
          event.stopPropagation()
          swipe.close()
        }}
        {...swipe.handlers}
      >
        <button
          type="button"
          className="sky-check"
          aria-label={struck ? 'Done' : 'Mark done'}
          onClick={() => !struck && onCheck(item)}
        >
          <span className="sky-check-box" data-on={struck}>
            {struck && <Tick />}
          </span>
        </button>
        {timed && (
          <span className="sky-when" data-tone={struck ? undefined : tone}>
            {item.time ? clock(item.time) : '—'}
          </span>
        )}
        <span className="sky-ptext" data-done={struck}>
          {item.link ? <a href={fileHref(resolvePath(at, item.link.path))}>{item.text}</a> : item.text}
          <button type="button" className="sky-x" aria-label="Delete" title="Delete" onClick={() => onDelete(item)}>
            <Cross />
          </button>
        </span>
        {tone === 'late' && !struck && <span className="sky-late">overdue</span>}
        {chip && item.category === 'Personal' && <span className="sky-pchip">Personal</span>}
      </div>
    </div>
  )
}

/** A commitment-shaped card: timed rows in time order, next in ink, overdue amber. */
function PlanCard({
  head,
  items,
  today,
  checkOff,
  at,
}: {
  head: string
  items: DayItem[]
  today: boolean
  checkOff: CheckOff
  at: string
}) {
  if (items.length === 0) return null
  const sorted = [...items].sort((a, b) => (minutesOf(a.time) ?? NO_TIME) - (minutesOf(b.time) ?? NO_TIME))
  const timed = sorted.some((i) => i.time)
  const nowMin = today ? currentMinutes() : null
  const open = (item: DayItem) => !item.done && !checkOff.phases[itemKey(item)]
  const next = nowMin === null ? null : sorted.find((i) => open(i) && (minutesOf(i.time) ?? -1) >= nowMin)
  const doneCount = sorted.filter((i) => i.done).length
  const mini = `${doneCount} of ${sorted.length} done` + (next?.time ? ` · next at ${clock(next.time)}` : '')
  const visible = sorted.filter((i) => !i.done || checkOff.phases[itemKey(i)])
  if (visible.length === 0 && doneCount === sorted.length) {
    return (
      <Block head={head} mini={mini}>
        <div className="sky-alldone">All done.</div>
      </Block>
    )
  }
  return (
    <Block head={head} mini={mini}>
      {visible.map((item) => {
        const key = itemKey(item)
        const minutes = minutesOf(item.time)
        const tone =
          next && itemKey(next) === key
            ? ('next' as const)
            : nowMin !== null && minutes !== null && minutes < nowMin && open(item)
              ? ('late' as const)
              : undefined
        return (
          <Fragment key={key}>
            <PlanRow
              item={item}
              phase={checkOff.phases[key]}
              timed={timed}
              tone={tone}
              chip
              soft={false}
              at={at}
              onCheck={checkOff.check}
              onDelete={checkOff.remove}
            />
          </Fragment>
        )
      })}
    </Block>
  )
}

/** To-dos, grouped by the category their heading filed them under. */
function TodoCard({ items, checkOff, at }: { items: DayItem[]; checkOff: CheckOff; at: string }) {
  if (items.length === 0) return null
  const order: Array<string | null> = []
  const groups = new Map<string | null, DayItem[]>()
  for (const item of items) {
    if (!groups.has(item.category)) {
      groups.set(item.category, [])
      order.push(item.category)
    }
    groups.get(item.category)?.push(item)
  }
  const doneCount = items.filter((i) => i.done).length
  return (
    <Block head="To-dos" mini={`${doneCount} of ${items.length} done`}>
      {order.map((label) => {
        const rows = (groups.get(label) ?? []).filter((i) => !i.done || checkOff.phases[itemKey(i)])
        if (rows.length === 0) return null
        return (
          <Fragment key={label ?? ''}>
            {label && <div className="sky-igroup">{label}</div>}
            {rows.map((item) => (
              <Fragment key={itemKey(item)}>
                <PlanRow
                  item={item}
                  phase={checkOff.phases[itemKey(item)]}
                  timed={false}
                  tone={undefined}
                  chip={false}
                  soft={false}
                  at={at}
                  onCheck={checkOff.check}
                  onDelete={checkOff.remove}
                />
              </Fragment>
            ))}
          </Fragment>
        )
      })}
    </Block>
  )
}

/** Reminders: lighter rows; a checked one leaves and lands nowhere. */
function ReminderCard({ items, checkOff, at }: { items: DayItem[]; checkOff: CheckOff; at: string }) {
  const visible = items.filter((i) => !i.done || checkOff.phases[itemKey(i)])
  if (visible.length === 0) return null
  const open = items.filter((i) => !i.done).length
  return (
    <Block head="Reminders" mini={String(open)}>
      {visible.map((item) => (
        <Fragment key={itemKey(item)}>
          <PlanRow
            item={item}
            phase={checkOff.phases[itemKey(item)]}
            timed={false}
            tone={undefined}
            chip={false}
            soft
            at={at}
            onCheck={checkOff.check}
            onDelete={checkOff.remove}
          />
        </Fragment>
      ))}
    </Block>
  )
}

/** A filed document with its time — the day-so-far row. */
function DocLine({ when, tag, children }: { when: string | null; tag?: string | null; children: ReactNode }) {
  return (
    <div className="sky-rec-line">
      <span className="sky-dat">{when ? clock(when) : ''}</span>
      <span className="sky-rec-txt">{children}</span>
      {tag && <span className="sky-medium">{tag}</span>}
    </div>
  )
}

/** Long blocks show a few rows and the rest on request — the day stays scannable. */
function Fold<T>({ rows, render, limit = 6 }: { rows: T[]; render: (row: T, i: number) => ReactNode; limit?: number }) {
  const [open, setOpen] = useState(false)
  const folded = !open && rows.length > limit + 2
  const shown = folded ? rows.slice(0, limit) : rows
  return (
    <>
      {shown.map((row, i) => (
        <Fragment key={i}>{render(row, i)}</Fragment>
      ))}
      {folded && (
        <button type="button" className="sky-more" onClick={() => setOpen(true)}>
          Show all {rows.length}
        </button>
      )}
    </>
  )
}

/** The archive, folded to a line: the conversations filed for reference. The day's chats are the rail's. */
function FiledCard({ archive }: { archive: DayRecord['messages']['archive'] }) {
  const [showArchive, setShowArchive] = useState(false)
  if (archive.length === 0) return null
  return (
    <Block head="Filed">
      {archive.length > 0 && (
        <>
          <div className="sky-fold-line">
            <span>{count(archive.length, 'conversation')} filed for reference</span>
            <button type="button" className="sky-showlink" onClick={() => setShowArchive((v) => !v)}>
              {showArchive ? 'Hide' : 'Show'}
            </button>
          </div>
          {showArchive &&
            archive.map((m) => (
              <Fragment key={m.path}>
                <DocLine when={m.when} tag={mediumLabel(m.medium)}>
                  <a href={fileHref(m.path)}>{m.title}</a>
                  {(m.from || m.to) && (
                    <span className="sky-rec-sub">{[m.from, m.to].filter(Boolean).join(' → ')}</span>
                  )}
                </DocLine>
              </Fragment>
            ))}
        </>
      )}
    </Block>
  )
}

const DAY_HINTS = (
  <>
    <span className="sky-hint">Enter to send</span>
    <span className="sky-hint">·</span>
    <span className="sky-hint">Shift+Enter for a new line</span>
  </>
)

export function DayView({
  chat,
  day,
  threads,
  imports = [],
  notes,
  onOpen,
  onOpenImport = () => {},
  dragging = false,
  attach,
  kept = [],
  onKept = () => {},
  onUndoKept = () => {},
  onDismissKept = () => {},
}: {
  chat: Chat
  day: DayData | null
  threads: ThreadSummary[]
  /** Files dropped on the day, running or done — rows beside the threads */
  imports?: ImportJob[]
  notes: Note[]
  onOpen: (id: string) => void
  onOpenImport?: (id: string) => void
  /** Files are held over the page */
  dragging?: boolean
  attach?: ComposerAttach
  /** Files just kept: the toast holds Undo for a moment */
  kept?: Kept[]
  /** The rail's pad moved or copied these */
  onKept?: (kept: Kept[]) => void
  onUndoKept?: () => void
  onDismissKept?: () => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  // The record reads top-down; the column follows only once a conversation is running in it.
  useFollow(scrollRef, [chat.state.turns, chat.state.gather], chat.state.turns.length > 0 || Boolean(chat.state.gather))

  // Checking a box answers with the fresh view; it lands here, over the prop.
  const [view, setView] = useState<DayData | null>(day)
  useEffect(() => setView(day), [day])
  const checkOff = useCheckOff(view?.day.ymd ?? '', setView)
  // The rail beside the day: a third column on a wide window, an overlay from
  // the header on a narrow one — the same rule as a document's Details.
  const rail = useRail(view?.day.ymd ?? null)
  const section = view?.section ?? null
  const record = view?.record ?? null
  const isToday = view ? view.day.ymd === view.today.ymd : false
  // The day file's directory: the items in it link to files from there.
  const at = view?.day.dayRelativePath ? view.day.dayRelativePath.split('/').slice(0, -1).join('/') : ''

  // What got done, wherever it was promised: struck plan items join the Complete
  // lists. A struck plan item can be put back (its list still holds it); a
  // Complete-list entry is the day's own record and stays as written.
  const doneToday: Array<{ item: DayItem; undoable: boolean }> = record
    ? [
        ...record.done.map((item) => ({ item, undoable: false })),
        ...[...record.mostImportant, ...record.commitments, ...record.todos]
          .filter((i) => i.done)
          .map((item) => ({ item, undoable: true })),
      ].sort((a, b) => (minutesOf(a.item.time) ?? NO_TIME) - (minutesOf(b.item.time) ?? NO_TIME))
    : []

  const hasPlan =
    record !== null &&
    (record.mostImportant.length > 0 ||
      record.commitments.length > 0 ||
      record.todos.length > 0 ||
      record.reminders.length > 0 ||
      (section !== null && (section.streaks.length > 0 || section.mostImportant.length > 0)))
  const hasDayFar =
    record !== null &&
    (record.meetings.length > 0 ||
      record.messages.involved.length > 0 ||
      doneToday.length > 0 ||
      record.journals.length + record.notes.length > 0 ||
      record.messages.archive.length > 0)

  return (
    <div className="sky-main sky-day">
      <header className="sky-head">
        <span className="sky-title">{view?.day.dateLabel ?? 'Today'}</span>
        <nav className="sky-tabs">
          {view?.day.dayRelativePath && (
            <Button size="sm" component="a" href={fileHref(view.day.dayRelativePath)}>
              Day file
            </Button>
          )}
          <Button
            size="sm"
            variant={rail.open ? 'light' : 'subtle'}
            disabled={!view}
            onClick={rail.toggle}
            data-active={rail.open}
            aria-pressed={rail.open}
          >
            Details
          </Button>
        </nav>
      </header>

      <div className="sky-split">
        <div className="sky-split-main">
          <div className="sky-scroll" ref={scrollRef}>
            <div className="sky-col">
              {notes.map((note, i) => (
                <Fragment key={i}>
                  <NoteLine note={note} />
                </Fragment>
              ))}

              {record && (
                <>
                  {hasPlan && <div className="sky-sect">What needs to get done</div>}

                  <PlanCard
                    head="Most important"
                    items={record.mostImportant}
                    today={isToday}
                    checkOff={checkOff}
                    at={at}
                  />
                  <PlanCard head="Commitments" items={record.commitments} today={isToday} checkOff={checkOff} at={at} />
                  <TodoCard items={record.todos} checkOff={checkOff} at={at} />
                  <ReminderCard items={record.reminders} checkOff={checkOff} at={at} />

                  {section && (section.streaks.length > 0 || section.mostImportant.length > 0) && (
                    <Block
                      head={section.mostImportant.length > 0 ? 'Today' : 'Streaks'}
                      mini={`${section.streaks.filter((s) => s.doneToday).length} of ${section.streaks.length} done`}
                    >
                      {section.mostImportant.map((item) => (
                        <div key={item.relativePath} className="sky-rec-line">
                          <span className="sky-rec-txt">
                            <a href={fileHref(item.relativePath)}>{item.label}</a>
                          </span>
                        </div>
                      ))}
                      {section.streaks.map((streak) => (
                        <div key={streak.title} className="sky-prow">
                          <span className="sky-scheck" data-on={streak.doneToday}>
                            {streak.doneToday && <Tick />}
                          </span>
                          <span className="sky-ptext" data-dim={streak.doneToday || undefined}>
                            {streak.title}
                          </span>
                        </div>
                      ))}
                    </Block>
                  )}

                  {hasDayFar && <div className="sky-sect">The day so far</div>}

                  {record.meetings.length > 0 && (
                    <Block head="Meetings" mini={String(record.meetings.length)}>
                      {record.meetings.map((m) => (
                        <Fragment key={m.path}>
                          <DocLine when={m.when}>
                            <a href={fileHref(m.path)}>{m.title}</a>
                            {m.who && <span className="sky-rec-sub">{m.who}</span>}
                          </DocLine>
                        </Fragment>
                      ))}
                    </Block>
                  )}

                  {record.messages.involved.length > 0 && (
                    <Block head="Messages" mini={count(record.messages.involved.length, 'conversation')}>
                      <Fold
                        rows={record.messages.involved}
                        render={(m: DayRecord['messages']['involved'][number]) => (
                          <DocLine when={m.when} tag={mediumLabel(m.medium)}>
                            <a href={fileHref(m.path)}>{m.title}</a>
                            {(m.from || m.to) && (
                              <span className="sky-rec-sub">{[m.from, m.to].filter(Boolean).join(' → ')}</span>
                            )}
                          </DocLine>
                        )}
                      />
                    </Block>
                  )}

                  {doneToday.length > 0 && (
                    <Block head="Done today" mini={String(doneToday.length)}>
                      <Fold
                        rows={doneToday}
                        render={({ item, undoable }) => (
                          <div className="sky-prow">
                            {undoable ? (
                              <button
                                type="button"
                                className="sky-check"
                                aria-label="Put back"
                                title="Put back"
                                onClick={() => checkOff.uncheck(item)}
                              >
                                <span className="sky-check-box" data-on="true">
                                  <Tick />
                                </span>
                              </button>
                            ) : (
                              <span className="sky-done-tick">
                                <Tick />
                              </span>
                            )}
                            <span className="sky-when">{item.time ? clock(item.time) : ''}</span>
                            <span className="sky-ptext sky-done-text">
                              {item.link ? (
                                <a href={fileHref(resolvePath(at, item.link.path))}>{item.text}</a>
                              ) : (
                                item.text
                              )}
                            </span>
                            {item.category === 'Personal' && <span className="sky-pchip">Personal</span>}
                          </div>
                        )}
                      />
                    </Block>
                  )}

                  {(record.journals.length > 0 || record.notes.length > 0) && (
                    <Block head="Written" mini={String(record.journals.length + record.notes.length)}>
                      {record.journals.map((row) => (
                        <Fragment key={row.path}>
                          <DocLine when={row.when}>
                            <a href={fileHref(row.path)}>{row.title}</a>
                          </DocLine>
                        </Fragment>
                      ))}
                      {record.notes.map((row) => (
                        <Fragment key={row.path}>
                          <DocLine when={row.when}>
                            <a href={fileHref(row.path)}>{row.title}</a>
                            <span className="sky-rec-sub">note</span>
                          </DocLine>
                        </Fragment>
                      ))}
                    </Block>
                  )}

                  <FiledCard archive={record.messages.archive} />
                </>
              )}

              <ThreadColumn chat={chat} />

              {chat.state.turns.length === 0 && !chat.state.gather && (
                <div className="sky-blank" style={{ height: 'auto', padding: '24px 0' }}>
                  <p>Ask the day anything, or start a chat — answers come from your files.</p>
                </div>
              )}
            </div>
          </div>

          <Composer chat={chat} placeholder="Message the day…" hints={DAY_HINTS} attach={attach} />
        </div>
        {rail.open && view && (
          <DayRail
            ymd={view.day.ymd}
            chats={view.chats}
            threads={threads}
            imports={imports}
            onOpenThread={onOpen}
            onOpenImport={onOpenImport}
            onKept={onKept}
            onClose={rail.narrow ? rail.close : undefined}
          />
        )}
      </div>

      {checkOff.undo && (
        <div className="sky-undo" key={checkOff.undo.key}>
          <span className="sky-undo-tick" data-how={checkOff.undo.how}>
            {checkOff.undo.how === 'deleted' ? <Cross /> : <Tick />}
          </span>
          <span className="sky-undo-text">
            {UNDO_WORDS[checkOff.undo.how]} — “{checkOff.undo.text}”
          </span>
          <button type="button" className="sky-undo-btn" onClick={checkOff.revert}>
            Undo
          </button>
          <span className="sky-undo-track">
            <span className="sky-undo-fill" />
          </span>
        </div>
      )}

      {kept.length > 0 && !checkOff.undo && (
        <KeptToast kept={kept} todayYmd={view?.today.ymd ?? null} onUndo={onUndoKept} onDone={onDismissKept} />
      )}

      {dragging && <DropOverlay />}
    </div>
  )
}
