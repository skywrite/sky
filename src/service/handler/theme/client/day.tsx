import { Button } from '@mantine/core'
import { Fragment, type ReactNode, useEffect, useRef, useState } from 'react'
import { type Chat, Composer, type Note, NoteLine, ThreadColumn, useFollow } from './chat.tsx'
import { fileHref, resolvePath } from './explorer.tsx'

/**
 * The day is the page. Its column is the day's own conversation, the
 * threads running inside it with what each is doing, and the day's
 * record so far. A thread is one click away; the day is where you wait
 * for several at once instead of staring at one.
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

export type ThreadState = 'new' | 'reading' | 'thinking' | 'streaming' | 'done' | 'failed' | 'saving'

export interface ThreadSummary {
  id: string
  title: string | null
  state: ThreadState
  line: string | null
  when: string | null
  turns: number
  busy: boolean
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
// Rendering
// -----------------------------------------------------------------------------

const STATE_TONE: Record<ThreadState, 'quiet' | 'live' | 'done' | 'failed'> = {
  new: 'quiet',
  reading: 'quiet',
  thinking: 'live',
  streaming: 'live',
  done: 'done',
  failed: 'failed',
  saving: 'quiet',
}

function RunningRow({ thread, onOpen }: { thread: ThreadSummary; onOpen: (id: string) => void }) {
  const line = thread.state === 'new' ? null : thread.line ? `${thread.state} · ${thread.line}` : thread.state
  return (
    <div className="sky-run">
      <span className="sky-run-dot">
        <span className="sky-dot" data-tone={STATE_TONE[thread.state]} />
      </span>
      <span className="sky-run-txt">
        {thread.title ?? 'New chat'}
        {line && <span className="sky-run-line">{line}</span>}
      </span>
      {thread.when && <span className="sky-run-at">{thread.when}</span>}
      <Button onClick={() => onOpen(thread.id)}>Open</Button>
    </div>
  )
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

/** A plan item: dot, text (struck when done), the category it was filed under. `at` is the day's directory — its links are written from there. */
function ItemRow({ item, at }: { item: DayItem; at: string }) {
  return (
    <div className="sky-todo" data-done={item.done}>
      <span className="sky-run-dot">
        <span className="sky-dot" data-tone={item.done ? 'done' : 'quiet'} />
      </span>
      <span className="sky-todo-label">
        {item.link ? <a href={fileHref(resolvePath(at, item.link.path))}>{item.text}</a> : item.text}
      </span>
      {item.category && <span className="sky-tag">{item.category.toLowerCase()}</span>}
    </div>
  )
}

/** A filed document with its time: what it is, and who it was with. */
function DocRow({ row, sub, tag }: { row: DayDocRow; sub?: string | null; tag?: string | null }) {
  return (
    <div className="sky-rec-line">
      <span className="sky-rec-at sky-rec-when">{row.when ?? ''}</span>
      <span className="sky-rec-txt">
        <a href={fileHref(row.path)}>{row.title}</a>
        {sub && <span className="sky-rec-sub">{sub}</span>}
      </span>
      {tag && <span className="sky-tag">{tag}</span>}
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

function Items({ head, items, at }: { head: string; items: DayItem[]; at: string }) {
  if (items.length === 0) return null
  const open = items.filter((i) => !i.done).length
  return (
    <Block head={head} mini={open === items.length ? count(items.length, 'item') : `${open} open of ${items.length}`}>
      <Fold rows={items} render={(item) => <ItemRow item={item} at={at} />} />
    </Block>
  )
}

function Block({ head, mini, children }: { head: string; mini?: string; children: ReactNode }) {
  return (
    <div className="sky-block">
      <div className="sky-block-head">
        {head}
        <span className="sky-spacer" />
        {mini && <span className="sky-mini">{mini}</span>}
      </div>
      <div className="sky-block-pad">{children}</div>
    </div>
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
  notes,
  onOpen,
}: {
  chat: Chat
  day: DayData | null
  threads: ThreadSummary[]
  notes: Note[]
  onOpen: (id: string) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  // The record reads top-down; the column follows only once a conversation is running in it.
  useFollow(scrollRef, [chat.state.turns, chat.state.gather], chat.state.turns.length > 0 || Boolean(chat.state.gather))
  const running = threads.filter((t) => t.busy).length
  const section = day?.section ?? null
  const record = day?.record ?? null
  // The day file's directory: the items in it link to files from there.
  const at = day?.day.dayRelativePath ? day.day.dayRelativePath.split('/').slice(0, -1).join('/') : ''

  return (
    <div className="sky-main">
      <header className="sky-head">
        <span className="sky-title">{day?.day.dateLabel ?? 'Today'}</span>
        <nav className="sky-tabs">
          {threads.length > 0 && (
            <span className="sky-head-count">
              {threads.length} thread{threads.length === 1 ? '' : 's'}
              {running > 0 ? ` · ${running} running` : ''}
            </span>
          )}
          {day?.day.dayRelativePath && (
            <Button size="sm" component="a" href={fileHref(day.day.dayRelativePath)}>
              Day file
            </Button>
          )}
        </nav>
      </header>

      <div className="sky-scroll" ref={scrollRef}>
        <div className="sky-col">
          {notes.map((note, i) => (
            <Fragment key={i}>
              <NoteLine note={note} />
            </Fragment>
          ))}

          {record && (
            <>
              <Items head="Most important" items={record.mostImportant} at={at} />
              <Items head="Commitments" items={record.commitments} at={at} />
              <Items head="Todos" items={record.todos} at={at} />

              {section && (section.streaks.length > 0 || section.mostImportant.length > 0) && (
                <Block
                  head={section.mostImportant.length > 0 ? 'Today' : 'Streaks'}
                  mini={`${section.streaks.filter((s) => s.doneToday).length} of ${section.streaks.length} done`}
                >
                  {section.mostImportant.map((item) => (
                    <a key={item.relativePath} className="sky-filed" href={fileHref(item.relativePath)}>
                      <span className="sky-rec-at">⌗</span>
                      <span>{item.label}</span>
                    </a>
                  ))}
                  {section.streaks.map((streak) => (
                    <div key={streak.title} className="sky-todo" data-done={streak.doneToday}>
                      <span className="sky-run-dot">
                        <span className="sky-dot" data-tone={streak.doneToday ? 'done' : 'quiet'} />
                      </span>
                      <span className="sky-todo-label">{streak.title}</span>
                      <span className="sky-tag">{streak.doneToday ? 'done' : 'today'}</span>
                    </div>
                  ))}
                </Block>
              )}

              {record.meetings.length > 0 && (
                <Block head="Meetings" mini={count(record.meetings.length, 'meeting')}>
                  {record.meetings.map((m) => (
                    <Fragment key={m.path}>
                      <DocRow row={m} sub={m.who} />
                    </Fragment>
                  ))}
                </Block>
              )}

              {record.messages.involved.length > 0 && (
                <Block head="Messages" mini={count(record.messages.involved.length, 'thread')}>
                  <Fold
                    rows={record.messages.involved}
                    render={(m) => <DocRow row={m} sub={[m.from, m.to].filter(Boolean).join(' → ')} tag={m.medium} />}
                  />
                </Block>
              )}

              {record.done.length > 0 && (
                <Block head="Done" mini={count(record.done.length, 'item')}>
                  <Fold
                    rows={record.done}
                    render={(item) => (
                      <div className="sky-rec-line">
                        <span className="sky-rec-at sky-rec-when">{item.time ?? ''}</span>
                        <span className="sky-rec-txt">
                          {item.link ? <a href={fileHref(resolvePath(at, item.link.path))}>{item.text}</a> : item.text}
                        </span>
                        {item.category && <span className="sky-tag">{item.category.toLowerCase()}</span>}
                      </div>
                    )}
                  />
                </Block>
              )}

              {(record.journals.length > 0 || record.notes.length > 0) && (
                <Block head="Written" mini={count(record.journals.length + record.notes.length, 'file')}>
                  {[...record.journals, ...record.notes].map((row) => (
                    <a key={row.path} className="sky-filed" href={fileHref(row.path)}>
                      <span className="sky-rec-at">{row.when ?? '⌗'}</span>
                      <span>{row.title}</span>
                    </a>
                  ))}
                </Block>
              )}

              {record.messages.archive.length > 0 && (
                <Block head="Filed for reference" mini={count(record.messages.archive.length, 'thread')}>
                  <Fold
                    rows={record.messages.archive}
                    render={(m) => <DocRow row={m} sub={[m.from, m.to].filter(Boolean).join(' → ')} tag={m.medium} />}
                  />
                </Block>
              )}
            </>
          )}

          {day && day.chats.length > 0 && (
            <Block head="Filed today" mini={`${day.chats.length} chat${day.chats.length === 1 ? '' : 's'}`}>
              {day.chats.map((c) => (
                <a key={c.path} className="sky-filed" href={fileHref(c.path)}>
                  <span className="sky-rec-at">{c.time}</span>
                  <span>{c.summary || c.path}</span>
                  <span className="sky-tag">
                    {c.exchanges} turn{c.exchanges === 1 ? '' : 's'}
                  </span>
                </a>
              ))}
            </Block>
          )}

          {threads.length > 0 && (
            <Block head="Running" mini={running > 0 ? `${running} on sky` : 'all quiet'}>
              {threads.map((t) => (
                <Fragment key={t.id}>
                  <RunningRow thread={t} onOpen={onOpen} />
                </Fragment>
              ))}
            </Block>
          )}

          <ThreadColumn chat={chat} />

          {chat.state.turns.length === 0 && !chat.state.gather && threads.length === 0 && (
            <div className="sky-blank" style={{ height: 'auto', padding: '24px 0' }}>
              <p>Ask the day anything, or start a chat — answers come from your files.</p>
            </div>
          )}
        </div>
      </div>

      <Composer chat={chat} placeholder="Message the day…" hints={DAY_HINTS} />
    </div>
  )
}
