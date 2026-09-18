import { ActionIcon, Button, Tooltip } from '@mantine/core'
import { Fragment, type ReactNode, useEffect, useRef, useState } from 'react'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import { dayItemKey, type CommitmentOrder } from '../../day/organizingTypes.ts'
import { comparePlanItems } from '../../day/planningTypes.ts'
import { type ChatCloseNotice, DayChatClose } from './dayChatClose.tsx'
import { DayChatResume } from './dayChatResume.tsx'
import { chatState, chatTurnCount, type DayChatRow, dayChatRows } from './dayChats.ts'
import { DayItemEditing, InlineItemEditor, ItemDetailsIcon, useItemEditing } from './dayItemEditing.tsx'
import { DayItemHelp, ItemHelpButton } from './dayItemHelp.tsx'
import {
  DayCommitmentOrder,
  DayItemGrip,
  DayOrganizeButton,
  DayOrganizingBar,
  DayOrganizingContext,
  DayOrganizingFeedback,
  DayOrganizingHint,
  useDayOrganizing,
  useItemOrganizing,
} from './dayOrganizing.tsx'
import { useDayPlanning } from './dayPlanning.tsx'
import { DayRail } from './dayRail.tsx'
import { DayTracking } from './dayTracking.tsx'
import { fileHref, resolvePath } from './explorer.tsx'
import { type Kept, KeptToast } from './files.tsx'
import { acceptsImports, DropOverlay, type ImportJob, type MeetingImport } from './import.tsx'
import { useRail } from './rail.ts'
import { RailToggle } from './railToggle.tsx'
import { DayStreaks } from './streaks.tsx'
import { revealOpacity, useSwipeToDelete } from './swipe.ts'

/**
 * The day is the page. Its column is what needs to get done — with
 * checkboxes that write back to the day file — then the day's record, the
 * conversations listed in its record. A checked
 * task stays at the top of its list; a checked reminder leaves; an item
 * can also be taken off the day through Delete or a swipe on the
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
  section: null
  chats: Array<{
    path: string
    time: string
    summary: string
    exchanges: number
    /** The chat this one branched from, and the turn it left after; null for one that began on its own */
    parent: { chat: string; turn: number } | null
  }>
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
  revision?: string
  workstream?: { id: string; activityId: string; kind: string; error?: string }
}

export interface DayDocRow {
  title: string
  path: string
  when: string | null
  summary: string | null
}

export interface DayRecord {
  ended: boolean
  endedAt: string | null
  manualOrder?: string[]
  commitmentsOrder?: CommitmentOrder
  mostImportant: DayItem[]
  commitments: DayItem[]
  todos: DayItem[]
  reminders: DayItem[]
  done: DayItem[]
  meetings: Array<DayDocRow & { who: string | null }>
  videos: Array<DayDocRow & { from: string | null; to: string | null; medium: string | null }>
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
  /** The chat this thread branched from, with the live thread it left when there is one */
  parent: { chat: string; turn: number; id: string | null; title: string | null } | null
  /** Messages at the head of the thread that are its parent's */
  inherited: number
  /** The saved chat this thread continues; null for one with no file yet */
  saved: string | null
}

/** The day named by `ymd`, or today when null. */
export function useDay(ymd: string | null, refreshKey?: string): DayData | null {
  const [day, setDay] = useState<DayData | null>(null)
  const requestedDay = useRef(ymd)
  useEffect(() => {
    let alive = true
    if (requestedDay.current !== ymd) {
      requestedDay.current = ymd
      setDay(null)
    }
    fetch(ymd ? `/day/${ymd}` : '/day')
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => alive && setDay(body as DayData | null))
      .catch(() => alive && setDay(null))
    return () => {
      alive = false
    }
  }, [ymd, refreshKey])
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
  if (item.workstream) return `${item.workstream.id}:${item.workstream.activityId}`
  return `${item.list}\u0000${item.raw.replace(/~~/g, '').trim()}`
}

function minutesOf(time: string | null): number | null {
  const parts = /^(\d{1,2}):(\d{2})$/.exec(time ?? '')
  return parts ? Number(parts[1]) * 60 + Number(parts[2]) : null
}

/** `09:30` reads as `9:30`; ranges keep both ends readable. */
export function clock(when: string): string {
  return when.replace(/\b0(\d:\d\d)/g, '$1')
}

/** Frontmatter says `slack`; the page says `Slack`. */
function mediumLabel(medium: string | null): string | null {
  return medium ? medium.charAt(0).toUpperCase() + medium.slice(1) : null
}

function currentMinutes(): number {
  return minutesOf(new PlainDateTime().time) ?? 0
}

/* Checking stays visible; only deletion collapses a row. */
type ItemPhase = 'struck' | 'reopened' | 'removed'

function itemDone(item: DayItem, phases: Record<string, ItemPhase>): boolean {
  const phase = phases[itemKey(item)]
  return phase === 'struck' || (phase !== 'reopened' && item.done)
}

/** The action offered by Undo: checked off, a reminder cleared, or deleted. */
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
  readOnly: boolean
  phases: Record<string, ItemPhase>
  undo: UndoState | null
  check: (item: DayItem) => void
  /** Take an item off the day — the row's ×, or the phone's swipe */
  remove: (item: DayItem) => void
  revert: () => void
  dismissUndo: () => void
}

/**
 * Task checkboxes strike locally, stay in their lists, and can be unchecked
 * there or through Undo. Completing a reminder uses deletion: the row
 * collapses, the line leaves the file, and Undo puts it back where it was.
 */
function useCheckOff(ymd: string, applyView: (view: DayData) => void, readOnly: boolean): CheckOff {
  const [phases, setPhases] = useState<Record<string, ItemPhase>>({})
  const [undo, setUndo] = useState<UndoState | null>(null)
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setPhases({})
    setUndo(null)
    if (undoTimer.current) clearTimeout(undoTimer.current)
    return () => {
      if (undoTimer.current) clearTimeout(undoTimer.current)
    }
  }, [ymd, readOnly])

  const dropPhase = (key: string) =>
    setPhases((p) => {
      if (!(key in p)) return p
      const next = { ...p }
      delete next[key]
      return next
    })

  /** A write to the item routes; null when it did not land. */
  const send = async <T,>(route: string, body: unknown): Promise<T | null> => {
    if (readOnly) return null
    try {
      const response = await fetch(`/day/${ymd}/item${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (response.status === 409) {
        const rejected = (await response.json()) as { view?: DayData }
        if (rejected.view) applyView(rejected.view)
        return null
      }
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
    if (readOnly) return
    if (/^reminders$/i.test(item.list.trim())) {
      remove(item, 'cleared')
      return
    }
    if (item.done) {
      uncheck(item)
      return
    }
    const key = itemKey(item)
    if (phases[key]) return
    setPhases((p) => ({ ...p, [key]: 'struck' }))
    void post(item.list, item.raw, true).then((view) => {
      dropPhase(key)
      if (!view) return
      applyView(view)
      hold({ key, list: item.list, raw: item.raw, text: item.text, how: 'done', at: null })
    })
  }

  const remove = (item: DayItem, how: 'cleared' | 'deleted' = 'deleted') => {
    if (readOnly) return
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
      hold({ key, list: item.list, raw: item.raw, text: item.text, how, at: result.at })
    })
  }

  const revert = () => {
    if (readOnly) return
    const held = undo
    if (!held) return
    if (undoTimer.current) clearTimeout(undoTimer.current)
    setUndo(null)
    const back =
      held.at !== null
        ? send<DayData>('/restore', { list: held.list, raw: held.raw, at: held.at })
        : post(held.list, held.raw, false)
    void back.then((view) => {
      dropPhase(held.key)
      if (view) applyView(view)
    })
  }

  const uncheck = (item: DayItem) => {
    if (readOnly) return
    const key = itemKey(item)
    if (phases[key]) return
    setPhases((p) => ({ ...p, [key]: 'reopened' }))
    // If this very item's undo pill is up, this IS the undo — take the pill down with it.
    setUndo((held) => {
      if (held && held.key === key) {
        if (undoTimer.current) clearTimeout(undoTimer.current)
        return null
      }
      return held
    })
    void post(item.list, item.raw, false).then((view) => {
      dropPhase(key)
      if (view) applyView(view)
    })
  }

  return {
    readOnly,
    phases,
    undo: readOnly ? null : undo,
    check,
    remove,
    revert,
    dismissUndo: () => setUndo(null),
  }
}

// -----------------------------------------------------------------------------
// Rendering
// -----------------------------------------------------------------------------

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

export function Tick() {
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

export function Cross() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M2.5 2.5L9.5 9.5M9.5 2.5L2.5 9.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function StaticCheck({ done }: { done: boolean }) {
  return (
    <span className="sky-check-static" role="img" aria-label={done ? 'Complete' : 'Incomplete'}>
      <span className="sky-check-box" data-on={done}>
        {done && <Tick />}
      </span>
    </span>
  )
}

function EndedBadge({ at }: { at: string | null }) {
  return (
    <Tooltip
      label={
        at ? `Ended at ${clock(at.slice(11, 16))}. Tasks are read-only.` : 'This day has ended. Tasks are read-only.'
      }
      withArrow
      events={{ hover: true, focus: true, touch: true }}
    >
      <span className="sky-day-ended" tabIndex={0}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5" y="10" width="14" height="11" rx="2.5" />
            <path d="M8 10V7a4 4 0 1 1 8 0v3M12 14.5v2.5" />
          </g>
        </svg>
        Ended
      </span>
    </Tooltip>
  )
}

/** A page with a folded corner: the day's own file, beside its date. */
function DayFileIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 1.75h5.25L13 5.5v8.75H4z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M9.25 1.75V5.5H13" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M6.25 8.5h4.5M6.25 11h4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

export function Block({
  head,
  mini,
  action,
  children,
  className,
}: {
  head: string
  mini?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={className ? `sky-block ${className}` : 'sky-block'}>
      <div className="sky-block-head sky-bhead">
        {head}
        <span className="sky-spacer" />
        {mini && <span className="sky-count">{mini}</span>}
        {action}
      </div>
      <div className="sky-block-pad">{children}</div>
    </div>
  )
}

/** Markdown URLs encode filenames and carry fragments separately from the Explorer file path. */
function itemHref(item: DayItem, at: string): string {
  const link = item.link?.path ?? ''
  if (item.workstream || /^https?:\/\//i.test(link)) return link
  const [, encoded, suffix] = /^([^?#]*)(.*)$/.exec(link)!
  let file = encoded
  try {
    file = decodeURIComponent(encoded)
  } catch {
    /* A literal percent sign is still a valid filename. */
  }
  return fileHref(resolvePath(at, file).replace(/^\/+/, '')) + suffix
}

/**
 * One plan item: checkbox, its time when the list is timed, the text,
 * Personal when it's the exception, and Details and Delete controls.
 * Plain text edits in place; on the phone a swipe left still bares Delete.
 */
function PlanRow({
  item,
  readOnly,
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
  readOnly: boolean
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
  const struck = phase === 'struck' || (phase !== 'reopened' && item.done)
  const editor = useItemEditing()
  const organize = useItemOrganizing()
  const organizing = organize.active
  const active = editor.draft?.item.list === item.list && editor.draft.item.raw === item.raw
  const inline = active && editor.draft?.mode === 'inline'
  const locked = Boolean(editor.draft) || editor.busy || organize.busy || organizing
  const editable = !readOnly && !phase && !item.workstream && !organizing && !organize.busy
  const late = tone === 'late' && !struck
  const personal = chip && item.category === 'Personal'
  const pointer = useRef<{ x: number; y: number; at: number } | null>(null)
  const swipe = useSwipeToDelete(() => onDelete(item))
  // A row whose write did not land stands where it was — slid back if it had gone.
  useEffect(() => {
    if (!phase || readOnly || locked) swipe.close()
  }, [phase, readOnly, locked])
  return (
    <div
      className="sky-prow sky-irow"
      data-phase={phase}
      data-soft={soft || undefined}
      data-editing={inline || undefined}
      data-organize-key={dayItemKey(item)}
      data-organize-list={item.list}
      data-organizing={organizing || undefined}
      data-selected={(organizing && organize.selected.has(dayItemKey(item))) || undefined}
      data-sorting={organize.dragging === dayItemKey(item) || undefined}
      data-drop={organize.drop?.key === dayItemKey(item) ? (organize.drop.after ? 'after' : 'before') : undefined}
      ref={swipe.ref}
      onClick={(event) => {
        if (organizing && !(event.target as HTMLElement).closest('button')) {
          event.preventDefault()
          organize.toggle(item)
        }
      }}
    >
      {!readOnly && swipe.offset < 0 && (
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
        data-dragging={(!readOnly && swipe.dragging) || undefined}
        style={!readOnly && swipe.offset ? { transform: `translateX(${swipe.offset}px)` } : undefined}
        onClickCapture={(event) => {
          // A tap on an open row puts it back; nothing under the finger fires.
          if (readOnly || !swipe.open) return
          event.preventDefault()
          event.stopPropagation()
          swipe.close()
        }}
        {...(readOnly || locked ? {} : swipe.handlers)}
      >
        <span className="sky-item-grip-slot">
          {!readOnly && !inline && (
            <DayItemGrip
              item={item}
              disabled={Boolean(phase) || Boolean(editor.draft) || editor.busy || organize.busy}
            />
          )}
        </span>
        {organizing ? (
          <button
            type="button"
            className="sky-check sky-select-item"
            role="checkbox"
            aria-checked={organize.selected.has(dayItemKey(item))}
            aria-label={`Select ${item.text}`}
            disabled={organize.busy || !organize.canMove(item)}
            title={
              item.workstream
                ? 'Schedule this activity from its workstream'
                : !item.revision
                  ? 'Open the day file to organize this item'
                  : undefined
            }
            onClick={() => organize.toggle(item)}
          >
            <span className="sky-check-box" data-on={organize.selected.has(dayItemKey(item))}>
              {organize.selected.has(dayItemKey(item)) && <Tick />}
            </span>
          </button>
        ) : readOnly ? (
          <StaticCheck done={struck} />
        ) : (
          <button
            type="button"
            className="sky-check"
            aria-label={struck ? 'Mark not done' : item.workstream?.kind === 'decision' ? 'Open decision' : 'Mark done'}
            aria-pressed={struck}
            disabled={Boolean(phase) || Boolean(item.workstream?.error) || locked}
            onClick={() => {
              if (
                !struck &&
                item.workstream &&
                ['decision', 'subworkstream'].includes(item.workstream.kind) &&
                item.link
              )
                window.location.assign(item.link.path)
              else onCheck(item)
            }}
          >
            <span className="sky-check-box" data-on={struck}>
              {struck && <Tick />}
            </span>
          </button>
        )}
        {timed && (
          <span className="sky-when" data-tone={struck ? undefined : tone}>
            {item.time ? clock(item.time) : '—'}
          </span>
        )}
        <div className="sky-item-body">
          <div className="sky-item-title">
            {inline ? (
              <InlineItemEditor />
            ) : (
              <span
                className="sky-ptext"
                data-done={struck}
                role={editable && !item.link ? 'button' : undefined}
                tabIndex={editable && !item.link ? 0 : undefined}
                aria-label={editable && !item.link ? `Edit text: ${item.text}` : undefined}
                onDoubleClick={() => {
                  if (editable && !item.link) editor.begin(item, 'inline', window.getSelection()?.toString())
                }}
                onKeyDown={(event) => {
                  if (editable && !item.link && (event.key === 'Enter' || event.key === 'F2')) {
                    event.preventDefault()
                    editor.begin(item, 'inline')
                  }
                }}
                onPointerDown={(event) => {
                  pointer.current =
                    event.pointerType === 'touch' ? { x: event.clientX, y: event.clientY, at: performance.now() } : null
                }}
                onPointerCancel={() => {
                  pointer.current = null
                }}
                onPointerUp={(event) => {
                  const start = pointer.current
                  pointer.current = null
                  if (
                    editable &&
                    !item.link &&
                    start &&
                    performance.now() - start.at < 450 &&
                    Math.hypot(event.clientX - start.x, event.clientY - start.y) < 8 &&
                    !window.getSelection()?.toString()
                  )
                    editor.begin(item, 'inline')
                }}
              >
                {item.link && !organizing ? <a href={itemHref(item, at)}>{item.text}</a> : item.text}
                {item.workstream?.error && <span className="sky-pchip">{item.workstream.error}</span>}
              </span>
            )}
            {!readOnly && !inline && !organizing && (
              <span className="sky-item-actions">
                <ItemHelpButton
                  item={item}
                  href={item.link ? itemHref(item, at) : null}
                  disabled={Boolean(phase) || locked}
                />
                <button
                  type="button"
                  className="sky-item-details"
                  data-item={JSON.stringify([item.list, item.raw.split(/\r?\n/)[0]])}
                  aria-label="Item details"
                  title={item.workstream ? 'Open activity details' : 'Item details'}
                  disabled={Boolean(phase) || editor.busy || (locked && !active)}
                  onClick={() =>
                    item.workstream && item.link
                      ? window.location.assign(item.link.path)
                      : editor.begin(item, 'details')
                  }
                >
                  <ItemDetailsIcon />
                </button>
                <button
                  type="button"
                  className="sky-x"
                  aria-label="Delete"
                  title="Delete"
                  disabled={Boolean(phase) || locked}
                  onClick={() => onDelete(item)}
                >
                  <Cross />
                </button>
              </span>
            )}
          </div>
          {(late || personal) && (
            <span className="sky-item-meta">
              {late && <span className="sky-late">overdue</span>}
              {personal && <span className="sky-pchip">Personal</span>}
            </span>
          )}
        </div>
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
  className,
  children,
}: {
  head: string
  items: DayItem[]
  today: boolean
  checkOff: CheckOff
  at: string
  className?: string
  children?: ReactNode
}) {
  const organize = useItemOrganizing()
  if (items.length === 0 && !children) return null
  const timed = items.some((item) => item.time)
  const manual =
    head === 'Commitments'
      ? organize.commitmentsOrder === 'manual'
      : items.some((item) => organize.manualOrder.includes(item.list))
  const sorted = manual
    ? items
    : [...items].sort((a, b) =>
        comparePlanItems(
          { ...a, done: itemDone(a, checkOff.phases) },
          { ...b, done: itemDone(b, checkOff.phases) },
          timed,
        ),
      )
  const nowMin = today && !checkOff.readOnly ? currentMinutes() : null
  const open = (item: DayItem) => !itemDone(item, checkOff.phases) && !checkOff.phases[itemKey(item)]
  const next =
    nowMin === null
      ? null
      : [...items]
          .sort((a, b) => (minutesOf(a.time) ?? NO_TIME) - (minutesOf(b.time) ?? NO_TIME))
          .find((i) => open(i) && (minutesOf(i.time) ?? -1) >= nowMin)
  const doneCount = sorted.filter((item) => itemDone(item, checkOff.phases)).length
  const mini = `${doneCount} of ${sorted.length} done` + (next?.time ? ` · next at ${clock(next.time)}` : '')
  return (
    <Block
      head={head}
      mini={items.length ? mini : undefined}
      className={className}
      action={head === 'Commitments' && items.length ? <DayCommitmentOrder /> : undefined}
    >
      {sorted.map((item) => {
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
              readOnly={checkOff.readOnly}
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
      {children}
    </Block>
  )
}

/** To-dos, grouped by the category their heading filed them under. */
function TodoCard({
  items,
  checkOff,
  at,
  children,
  action,
}: {
  items: DayItem[]
  checkOff: CheckOff
  at: string
  children?: ReactNode
  action?: ReactNode
}) {
  const organize = useItemOrganizing()
  if (items.length === 0 && !children) return null
  const order: Array<string | null> = []
  const groups = new Map<string | null, DayItem[]>()
  for (const item of items) {
    if (!groups.has(item.category)) {
      groups.set(item.category, [])
      order.push(item.category)
    }
    groups.get(item.category)?.push(item)
  }
  const doneCount = items.filter((item) => itemDone(item, checkOff.phases)).length
  return (
    <Block head="To-dos" mini={items.length ? `${doneCount} of ${items.length} done` : undefined} action={action}>
      {order.map((label) => {
        const rows = [...(groups.get(label) ?? [])].sort((a, b) =>
          organize.manualOrder.includes(a.list) && a.list === b.list
            ? 0
            : comparePlanItems(
                { ...a, done: itemDone(a, checkOff.phases) },
                { ...b, done: itemDone(b, checkOff.phases) },
                false,
              ),
        )
        if (rows.length === 0) return null
        return (
          <Fragment key={label ?? ''}>
            {label && <div className="sky-igroup">{label}</div>}
            {rows.map((item) => (
              <Fragment key={itemKey(item)}>
                <PlanRow
                  item={item}
                  readOnly={checkOff.readOnly}
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
      {children}
    </Block>
  )
}

/** Reminders: lighter rows; a checked one leaves and lands nowhere. */
function ReminderCard({
  items,
  checkOff,
  at,
  children,
}: {
  items: DayItem[]
  checkOff: CheckOff
  at: string
  children?: ReactNode
}) {
  const visible = items.filter((i) => !i.done || checkOff.phases[itemKey(i)])
  if (visible.length === 0 && !children) return null
  const open = items.filter((i) => !i.done).length
  return (
    <Block head="Reminders" mini={String(open)}>
      {visible.map((item) => (
        <Fragment key={itemKey(item)}>
          <PlanRow
            item={item}
            readOnly={checkOff.readOnly}
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
      {children}
    </Block>
  )
}

/** A filed document with its time in the day's record. */
function DocLine({ when, tag, children }: { when: string | null; tag?: string | null; children: ReactNode }) {
  return (
    <div className="sky-rec-line">
      <span className="sky-dat">{when ? clock(when) : ''}</span>
      <span className="sky-rec-txt">{children}</span>
      {tag && <span className="sky-medium">{tag}</span>}
    </div>
  )
}

function ChatsCard({
  rows,
  onOpenThread,
  onOpenSaved,
}: {
  rows: DayChatRow[]
  onOpenThread: (id: string) => void
  onOpenSaved: (path: string) => void
}) {
  if (rows.length === 0) return null
  return (
    <Block head="Chats" mini={count(rows.length, 'chat')}>
      {rows.map((row) => (
        <div
          className="sky-day-chat"
          key={row.key}
          data-depth={row.depth}
          style={{ marginInlineStart: row.depth * 18 }}
        >
          <DocLine when={row.time} tag={chatState(row)}>
            <span className="sky-day-chat-heading">
              {row.path ? (
                <a className="sky-day-chat-open" href={fileHref(row.path)}>
                  {row.title}
                </a>
              ) : (
                <button
                  type="button"
                  className="sky-day-chat-open"
                  onClick={() => row.target.kind === 'live' && onOpenThread(row.target.id)}
                >
                  {row.title}
                </button>
              )}
              {row.path && (
                <DayChatResume
                  onClick={() =>
                    row.target.kind === 'live' ? onOpenThread(row.target.id) : onOpenSaved(row.target.path)
                  }
                />
              )}
            </span>
            <span className="sky-day-chat-meta">
              {chatTurnCount(row)}
              {row.parent && ` · from turn ${row.parent.turn} of ${row.parent.title}`}
            </span>
          </DocLine>
        </div>
      ))}
    </Block>
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

/** The archive, folded to a line: the conversations filed for reference. */
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

export function DayView({
  trackingDate = null,
  navigate = (path: string) => window.location.assign(path),
  day,
  threads,
  imports = [],
  chatNotice,
  onDismissChatNotice = () => {},
  onOpen,
  onHelp,
  onOpenSaved = () => {},
  onOpenImport = () => {},
  onImportMeeting,
  dragging = false,
  onImportFiles,
  kept = [],
  onKept = () => {},
  onUndoKept = () => {},
  onDismissKept = () => {},
}: {
  trackingDate?: string | null
  navigate?: (path: string) => void
  day: DayData | null
  threads: ThreadSummary[]
  /** Files dropped on the day, running or done — rows beside the threads */
  imports?: ImportJob[]
  chatNotice?: ChatCloseNotice
  onDismissChatNotice?: (id: string) => void
  onOpen: (id: string) => void
  onHelp?: (message: string) => Promise<void>
  /** A saved chat, by its notebook-relative path, opened to continue */
  onOpenSaved?: (chat: string) => void
  onOpenImport?: (id: string) => void
  onImportMeeting?: (files: File[], meeting: MeetingImport) => void
  /** Files are held over the page */
  dragging?: boolean
  onImportFiles?: (files: File[]) => void
  /** Files just kept: the toast holds Undo for a moment */
  kept?: Kept[]
  /** The rail's pad moved or copied these */
  onKept?: (kept: Kept[]) => void
  onUndoKept?: () => void
  onDismissKept?: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)

  // Checking a box answers with the fresh view; it lands here, over the prop.
  const [view, setView] = useState<DayData | null>(day)
  useEffect(() => setView(day), [day])
  const endedAt = view?.record.endedAt ?? null
  const ended = view?.record.ended ?? false
  const checkOff = useCheckOff(view?.day.ymd ?? '', setView, ended)
  const planning = useDayPlanning(view, setView, checkOff.dismissUndo, checkOff.undo)
  const organize = useDayOrganizing(
    view,
    setView,
    () => {
      checkOff.dismissUndo()
      planning.dismissUndo()
    },
    checkOff.undo ?? planning.undo,
    navigate,
  )
  // The rail beside the day: a third column on a wide window, an overlay from
  // the header on a narrow one — the same rule as a document's Details.
  const rail = useRail(view?.day.ymd ?? null)
  const record = view?.record ?? null
  const chats = view ? dayChatRows(view.day.ymd, view.chats, threads) : []
  const videos = record?.videos ?? []
  const isToday = view ? view.day.ymd === view.today.ymd : false
  // The day file's directory: the items in it link to files from there.
  const at = view?.day.dayRelativePath ? view.day.dayRelativePath.split('/').slice(0, -1).join('/') : ''
  const tasks = record ? [...record.mostImportant, ...record.commitments, ...record.todos] : []

  // Checked tasks stay in the plan; Done today holds the separate Complete lists.
  const doneToday = [...(record?.done ?? [])].sort(
    (a, b) => (minutesOf(a.time) ?? NO_TIME) - (minutesOf(b.time) ?? NO_TIME),
  )
  const completedTasks = doneToday.length + tasks.filter((item) => itemDone(item, checkOff.phases)).length
  const totalTasks = doneToday.length + tasks.length

  const content = (
    <div className="sky-main sky-day">
      <div className="sky-split">
        <div className="sky-split-main">
          <header className="sky-head">
            <span className="sky-title">
              {view?.day.dateLabel ?? 'Today'}
              {view?.day.dayRelativePath && (
                <ActionIcon
                  component="a"
                  href={fileHref(view.day.dayRelativePath)}
                  size="sm"
                  radius="sm"
                  className="sky-day-file"
                  aria-label="Day file"
                  title="Day file"
                >
                  <DayFileIcon />
                </ActionIcon>
              )}
            </span>
            {(ended || totalTasks > 0) && (
              <span className="sky-day-progress" role="status" aria-atomic="true">
                {ended && <EndedBadge at={endedAt} />}
                {ended && totalTasks > 0 && <span aria-hidden="true">·</span>}
                {totalTasks > 0 && (
                  <span>
                    {completedTasks} of {count(totalTasks, 'task')} complete
                  </span>
                )}
              </span>
            )}
            <nav className="sky-tabs">
              {onImportFiles && (
                <>
                  <input
                    ref={fileRef}
                    type="file"
                    hidden
                    multiple
                    accept={acceptsImports()}
                    onChange={(event) => {
                      const list = event.currentTarget.files
                      const files: File[] = list ? Array.from(list) : []
                      event.currentTarget.value = ''
                      if (files.length > 0) onImportFiles(files)
                    }}
                  />
                  <Button
                    aria-label="Add a file"
                    title="Import a file"
                    onClick={() => fileRef.current?.click()}
                    leftSection={
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        aria-hidden="true"
                      >
                        <path d="m8 13 7-7a3 3 0 0 1 4 4l-9 9a5 5 0 0 1-7-7l9-9a7 7 0 0 1 10 10l-9 9" />
                      </svg>
                    }
                  >
                    Add file
                  </Button>
                </>
              )}
              {!rail.open && <RailToggle open={false} onClick={rail.toggle} disabled={!view} />}
              <DayOrganizeButton disabled={planning.editing || Object.keys(checkOff.phases).length > 0} />
            </nav>
          </header>
          <DayOrganizingHint />

          <div className="sky-scroll">
            <div className="sky-col">
              {record && (
                <>
                  <PlanCard
                    head="Most important"
                    className="sky-day-priority"
                    items={record.mostImportant}
                    today={isToday}
                    checkOff={checkOff}
                    at={at}
                  />
                  <PlanCard head="Commitments" items={record.commitments} today={isToday} checkOff={checkOff} at={at}>
                    {!organize.active && planning.composer('commitments')}
                  </PlanCard>
                  <TodoCard
                    items={record.todos}
                    checkOff={checkOff}
                    at={at}
                    action={!organize.active && planning.nextButton}
                  >
                    {!organize.active && planning.composer('todos')}
                  </TodoCard>
                  <ReminderCard items={record.reminders} checkOff={checkOff} at={at}>
                    {!organize.active && planning.composer('reminders')}
                  </ReminderCard>

                  <DayStreaks ymd={view!.day.ymd} onNavigate={navigate} ended={ended} />

                  <DayTracking date={trackingDate} readOnly={trackingDate !== null && ended} navigate={navigate} />

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

                  {videos.length > 0 && (
                    <Block head="Videos" mini={String(videos.length)}>
                      <Fold
                        rows={videos}
                        render={(video: DayRecord['videos'][number]) => (
                          <DocLine when={video.when} tag={mediumLabel(video.medium)}>
                            <a href={fileHref(video.path)}>{video.title}</a>
                            {(video.from || video.to) && (
                              <span className="sky-rec-sub">{[video.from, video.to].filter(Boolean).join(' → ')}</span>
                            )}
                          </DocLine>
                        )}
                      />
                    </Block>
                  )}

                  <ChatsCard rows={chats} onOpenThread={onOpen} onOpenSaved={onOpenSaved} />

                  {doneToday.length > 0 && (
                    <Block head="Done today" mini={String(doneToday.length)}>
                      <Fold
                        rows={doneToday}
                        render={(item: DayItem) => (
                          <div className="sky-prow">
                            <span className="sky-done-tick">
                              <Tick />
                            </span>
                            <span className="sky-when">{item.time ? clock(item.time) : ''}</span>
                            <span className="sky-ptext sky-done-text">
                              {item.link ? <a href={itemHref(item, at)}>{item.text}</a> : item.text}
                            </span>
                            {item.category === 'Personal' && <span className="sky-pchip">Personal</span>}
                          </div>
                        )}
                      />
                    </Block>
                  )}

                  {record.journals.length > 0 && (
                    <Block head="Reflections" mini={String(record.journals.length)}>
                      {record.journals.map((row) => (
                        <Fragment key={row.path}>
                          <DocLine when={row.when}>
                            <a href={fileHref(row.path)}>{row.title}</a>
                            {row.summary?.trim() && <span className="sky-day-journal-summary">{row.summary}</span>}
                          </DocLine>
                        </Fragment>
                      ))}
                    </Block>
                  )}

                  {record.notes.length > 0 && (
                    <Block head="Notes" mini={String(record.notes.length)}>
                      {record.notes.map((row) => (
                        <Fragment key={row.path}>
                          <DocLine when={row.when}>
                            <a href={fileHref(row.path)}>{row.title}</a>
                          </DocLine>
                        </Fragment>
                      ))}
                    </Block>
                  )}

                  <FiledCard archive={record.messages.archive} />
                </>
              )}
            </div>
          </div>
          <DayOrganizingBar />
        </div>
        {rail.open && view && (
          <DayRail
            ymd={view.day.ymd}
            chats={view.chats}
            threads={threads}
            imports={imports}
            onOpenThread={onOpen}
            onOpenSaved={onOpenSaved}
            onOpenImport={onOpenImport}
            onImportMeeting={onImportMeeting}
            onKept={onKept}
            onToggle={rail.toggle}
          />
        )}
      </div>

      {planning.picker}
      {planning.toast}
      {organize.picker}
      <DayOrganizingFeedback />

      {checkOff.undo && !planning.toast && !organize.undo && !organize.error && (
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

      {kept.length > 0 && !checkOff.undo && !planning.toast && !organize.undo && !organize.error && (
        <KeptToast kept={kept} todayYmd={view?.today.ymd ?? null} onUndo={onUndoKept} onDone={onDismissKept} />
      )}

      {chatNotice && (
        <Fragment key={chatNotice.id}>
          <DayChatClose
            notice={chatNotice}
            blocked={Boolean(checkOff.undo || planning.toast || organize.undo || organize.error || kept.length)}
            onDismiss={onDismissChatNotice}
          />
        </Fragment>
      )}

      {dragging && <DropOverlay />}
    </div>
  )
  return (
    <DayItemEditing
      day={view}
      applyView={setView}
      onDelete={checkOff.remove}
      otherUndo={checkOff.undo ?? planning.undo ?? organize.undo}
      navigate={navigate}
      dismissOtherUndo={() => {
        checkOff.dismissUndo()
        planning.dismissUndo()
        organize.dismissUndo()
      }}
    >
      <Fragment key={view?.day.ymd}>
        <DayItemHelp day={view?.day ?? null} onStart={onHelp}>
          <DayOrganizingContext.Provider value={organize}>{content}</DayOrganizingContext.Provider>
        </DayItemHelp>
      </Fragment>
    </DayItemEditing>
  )
}
