import { Button } from '@mantine/core'
import { Fragment, type KeyboardEvent, useCallback, useEffect, useState } from 'react'
import { Block, clock, Cross } from './day.tsx'
import { fileHref } from './explorer.tsx'

/**
 * The week is a page. Its column is the seven days and what state each is
 * in — the one waiting to be started carries the page's primary button, a
 * day never ended carries its End — then the plan against the latest
 * check-in, and, for a week still ahead, what is already waiting for it:
 * the queue, the dated items, the backlog. Every button writes through the
 * week routes and the page renders the view that comes back.
 */

// -----------------------------------------------------------------------------
// What the service knows about the week
// -----------------------------------------------------------------------------

export type DayState = 'ended' | 'running' | 'open' | 'due' | 'blank' | 'upcoming'

export interface WeekDay {
  ymd: string
  weekday: string
  exists: boolean
  started: string | null
  ended: string | null
  perfect: boolean
  today: boolean
  state: DayState
  dayRelativePath: string | null
}

export interface GoalStatus {
  status: string
  text: string
  evidence: string | null
}

export interface QueueItem {
  text: string
  from: string | null
  raw: string
  file: string
}

export interface NextItem {
  text: string
  link: string | null
  raw: string
  file: string
  list: string
}

export interface ScheduledItem {
  text: string
  time: string | null
  category: 'Professional' | 'Personal'
  raw: string
  file: string
}

export interface ScheduledGroup {
  date: string
  items: ScheduledItem[]
}

export interface WeekData {
  id: string
  year: number
  number: number
  start: string
  end: string
  current: boolean
  future: boolean
  exists: boolean
  thisWeek: string
  previous: string
  next: { id: string; exists: boolean; planned: boolean }
  /** The day waiting to be started */
  due: { ymd: string; weekday: string } | null
  days: WeekDay[]
  plan: {
    path: string
    summary: string | null
    priorities: string[]
    goals: Array<{ category: string; text: string; done: boolean; raw: string; status: GoalStatus | null }>
  } | null
  checkins: {
    path: string
    count: number
    latest: {
      day: string
      time: string
      position: string
      grade: string | null
      verdict: string | null
      goals: GoalStatus[]
      edits: string[]
    } | null
  } | null
  queue: {
    weekNext: { professional: QueueItem[]; personal: QueueItem[] }
    scheduled: { inWeek: ScheduledGroup[]; later: ScheduledGroup[]; past: ScheduledGroup[] }
    next: { professional: NextItem[]; personal: NextItem[]; content: NextItem[] }
  } | null
}

/** `/week` is this week; `/week/<id>` another. Null when the page is not a week. */
export function weekIdOf(pathname: string): string | null {
  if (pathname === '/week') return ''
  return pathname.match(/^\/week\/(\d{4}-W\d{2})$/)?.[1] ?? null
}

export function weekHref(id: string): string {
  return id ? `/week/${id}` : '/week'
}

const api = (id: string) => (id ? `/week/_api/${id}` : '/week/_api')

/** The week named by `id`, or this week when empty. `reload` reads it again. */
export function useWeek(id: string | null): {
  view: WeekData | null
  setView: (view: WeekData) => void
  reload: () => void
} {
  const [view, setView] = useState<WeekData | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (id === null) return
    let alive = true
    fetch(api(id))
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => alive && setView(body as WeekData | null))
      .catch(() => alive && setView(null))
    return () => {
      alive = false
    }
  }, [id, tick])
  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { view, setView, reload }
}

// -----------------------------------------------------------------------------
// Words for dates
// -----------------------------------------------------------------------------

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function parts(ymd: string): { year: number; month: number; day: number } {
  const [year, month, day] = ymd.split('-').map(Number)
  return { year, month, day }
}

/** `September 7` */
function monthDay(ymd: string): string {
  const { month, day } = parts(ymd)
  return `${MONTHS[month - 1]} ${day}`
}

/** `Sep 7` */
function shortDate(ymd: string): string {
  const { month, day } = parts(ymd)
  return `${MONTHS[month - 1].slice(0, 3)} ${day}`
}

/** `August 31 – September 6`, or `September 7 – 13` inside one month */
function rangeLabel(start: string, end: string): string {
  const a = parts(start)
  const b = parts(end)
  return a.month === b.month ? `${MONTHS[a.month - 1]} ${a.day} – ${b.day}` : `${monthDay(start)} – ${monthDay(end)}`
}

function weekdayOf(ymd: string): string {
  const { year, month, day } = parts(ymd)
  return WEEKDAYS[new Date(year, month - 1, day).getDay()]
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

function statusTone(status: string): 'ok' | 'track' | 'risk' | undefined {
  if (status === 'done') return 'ok'
  if (status === 'on track') return 'track'
  if (status === 'at risk') return 'risk'
  return undefined
}

// -----------------------------------------------------------------------------
// Rendering
// -----------------------------------------------------------------------------

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="sky-qx" aria-label="Remove" title="Remove" onClick={onClick}>
      <Cross />
    </button>
  )
}

/** The seven days: what each is, and the button the one waiting for gets. */
function DaysBlock({
  days,
  busy,
  onOpenDay,
  onStart,
  onEnd,
}: {
  days: WeekDay[]
  busy: string | null
  onOpenDay: (day: WeekDay) => void
  onStart: (day: WeekDay) => void
  onEnd: (day: WeekDay) => void
}) {
  const open = days.filter((d) => d.state === 'open').length
  return (
    <Block head="Days" mini={open > 0 ? `${open} not ended` : undefined}>
      {days.map((d) => (
        <div className="sky-wrow" key={d.ymd}>
          <button
            type="button"
            className="sky-wday"
            data-today={d.today || undefined}
            disabled={!d.exists}
            onClick={() => onOpenDay(d)}
          >
            {d.weekday}
            <span className="sky-wdate">{shortDate(d.ymd)}</span>
          </button>
          {d.state === 'ended' && d.started && d.ended && (
            <span className="sky-wstate">
              {clock(d.started)} – {clock(d.ended)}
            </span>
          )}
          {d.state === 'ended' && d.perfect && (
            <span className="sky-wstate" data-tone="ok">
              perfect
            </span>
          )}
          {(d.state === 'running' || d.state === 'open') && d.started && (
            <span className="sky-wstate">
              {d.today ? 'today · ' : ''}started {clock(d.started)}
            </span>
          )}
          {d.state === 'open' && (
            <>
              <span className="sky-wstate" data-tone="warn">
                not ended
              </span>
              <Button size="sm" loading={busy === `end:${d.ymd}`} onClick={() => onEnd(d)}>
                End {d.weekday}
              </Button>
            </>
          )}
          {d.state === 'due' && (
            <>
              <span className="sky-wstate">not started yet</span>
              <Button size="sm" variant="light" loading={busy === `start:${d.ymd}`} onClick={() => onStart(d)}>
                Start {d.weekday}
              </Button>
            </>
          )}
          {d.state === 'blank' && <span className="sky-wstate">not started</span>}
          {d.state === 'upcoming' && (
            <span className="sky-wstate" data-tone="up">
              upcoming
            </span>
          )}
        </div>
      ))}
    </Block>
  )
}

/** The plan: priorities, then goals by category, each with the latest check-in's word on it. */
function PlanBlock({ plan }: { plan: NonNullable<WeekData['plan']> }) {
  const done = plan.goals.filter((g) => g.done || g.status?.status === 'done').length
  const categories: string[] = []
  for (const goal of plan.goals) if (!categories.includes(goal.category)) categories.push(goal.category)
  return (
    <Block head="Plan" mini={plan.goals.length > 0 ? `${done} of ${count(plan.goals.length, 'goal')} done` : undefined}>
      {plan.priorities.length > 0 && (
        <>
          <div className="sky-igroup" style={{ paddingTop: 2 }}>
            Priorities
          </div>
          {plan.priorities.map((priority, i) => (
            <div className="sky-pri" key={priority}>
              <span className="sky-num">{i + 1}</span>
              <span>{priority}</span>
            </div>
          ))}
        </>
      )}
      {categories.map((category) => (
        <Fragment key={category}>
          <div className="sky-igroup">{category}</div>
          {plan.goals
            .filter((g) => g.category === category)
            .map((goal) => (
              <div className="sky-goal" key={goal.raw}>
                <span className="sky-bullet" aria-hidden="true">
                  •
                </span>
                <span className="sky-goal-text">
                  <span data-done={goal.done || undefined}>{goal.text}</span>
                  {goal.status && (
                    <span
                      className="sky-status"
                      data-tone={statusTone(goal.status.status)}
                      title={goal.status.evidence ?? undefined}
                    >
                      {goal.status.status}
                    </span>
                  )}
                </span>
              </div>
            ))}
        </Fragment>
      ))}
    </Block>
  )
}

/** The latest check-in: its grade and verdict, and the plan edits it suggests. */
function CheckinBlock({ checkins }: { checkins: NonNullable<WeekData['checkins']> }) {
  const latest = checkins.latest
  if (!latest) return null
  return (
    <Block head="Check-in" mini={`${weekdayOf(latest.day)} ${latest.time} · ${latest.position}`}>
      {(latest.grade || latest.verdict) && (
        <div className="sky-verdict">
          {latest.grade && <b>Grade {latest.grade}</b>}
          {latest.grade && latest.verdict && ' — '}
          {latest.verdict}
        </div>
      )}
      <div className="sky-igroup" style={{ paddingTop: 4 }}>
        Suggested edits
      </div>
      {latest.edits.length === 0 && <div className="sky-wempty">None. The plan holds.</div>}
      {latest.edits.map((edit, i) => (
        <div className="sky-pri" key={edit}>
          <span className="sky-num">{i + 1}</span>
          <span>{edit}</span>
        </div>
      ))}
      <div className="sky-fold-line" style={{ paddingTop: 12 }}>
        <span style={{ flex: 'none' }}>{count(checkins.count, 'check-in')} so far</span>
        <a className="sky-showlink" href={fileHref(checkins.path)}>
          Open check-ins
        </a>
      </div>
    </Block>
  )
}

interface QueueActions {
  busy: string | null
  add: (text: string, category: 'Professional' | 'Personal', day: string | null) => Promise<boolean>
  remove: (file: string, list: string, raw: string) => void
  promote: (file: string, list: string, raw: string) => void
}

/** The queue for a week still ahead, and the row that adds to it. */
function QueueBlock({
  queue,
  days,
  actions,
}: {
  queue: NonNullable<WeekData['queue']>
  days: WeekDay[]
  actions: QueueActions
}) {
  const [text, setText] = useState('')
  const [category, setCategory] = useState<'Professional' | 'Personal'>('Professional')
  const [day, setDay] = useState<string | null>(null)
  const total = queue.weekNext.professional.length + queue.weekNext.personal.length
  const submit = async () => {
    if (!text.trim() || actions.busy) return
    if (await actions.add(text, category, day)) {
      setText('')
      setDay(null)
    }
  }
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      void submit()
    }
  }
  const rows = (items: QueueItem[]) =>
    items.map((item) => (
      <div className="sky-qrow" key={`${item.file} ${item.raw}`}>
        <span>{item.text}</span>
        {item.from && <span className="sky-from">from {item.from}</span>}
        <RemoveButton onClick={() => actions.remove(item.file, 'Week-Next', item.raw)} />
      </div>
    ))
  return (
    <Block head="For next week" mini={total > 0 ? count(total, 'item') : undefined}>
      {queue.weekNext.professional.length > 0 && (
        <>
          <div className="sky-igroup" style={{ paddingTop: 2 }}>
            Professional
          </div>
          {rows(queue.weekNext.professional)}
        </>
      )}
      {queue.weekNext.personal.length > 0 && (
        <>
          <div className="sky-igroup">Personal</div>
          {rows(queue.weekNext.personal)}
        </>
      )}
      {total === 0 && <div className="sky-wempty">Nothing waiting yet.</div>}
      <div className="sky-addrow">
        <input
          className="sky-addfield"
          type="text"
          placeholder="Add something for next week…"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKey}
          disabled={actions.busy === 'add'}
        />
        <div className="sky-seg">
          {(['Professional', 'Personal'] as const).map((choice) => (
            <button type="button" key={choice} data-on={category === choice} onClick={() => setCategory(choice)}>
              {choice}
            </button>
          ))}
        </div>
        <div className="sky-seg" data-days>
          {days.map((d) => (
            <button
              type="button"
              key={d.ymd}
              data-on={day === d.ymd}
              onClick={() => setDay(day === d.ymd ? null : d.ymd)}
              title={monthDay(d.ymd)}
            >
              {d.weekday.slice(0, 3)}
            </button>
          ))}
        </div>
        <div className="sky-addhint">
          {day
            ? `Scheduled for ${weekdayOf(day)}, ${monthDay(day)}: it lands on that day when the day starts.`
            : 'No day picked: it waits here for the plan. Pick a day and it is scheduled for it.'}
        </div>
      </div>
    </Block>
  )
}

/** Dated items from the schedule files: the week's, later ones, and dates that came and went. */
function ScheduledBlock({
  scheduled,
  actions,
}: {
  scheduled: NonNullable<WeekData['queue']>['scheduled']
  actions: QueueActions
}) {
  const all = [...scheduled.inWeek, ...scheduled.later, ...scheduled.past]
  const total = all.reduce((n, g) => n + g.items.length, 0)
  if (total === 0) return null
  const pastCount = scheduled.past.reduce((n, g) => n + g.items.length, 0)
  const rows = (group: ScheduledGroup, withDate: boolean) => {
    const timed = group.items.some((i) => i.time)
    const mixed = new Set(group.items.map((i) => i.category)).size > 1
    return group.items.map((item) => (
      <div className="sky-qrow" key={`${item.file} ${group.date} ${item.raw}`}>
        {timed && <span className="sky-when">{item.time ? clock(item.time) : ''}</span>}
        <span>{item.text}</span>
        {withDate && <span className="sky-from">{shortDate(group.date)}</span>}
        {(mixed || withDate) && item.category === 'Personal' && <span className="sky-pchip">Personal</span>}
        <RemoveButton onClick={() => actions.remove(item.file, group.date, item.raw)} />
      </div>
    ))
  }
  return (
    <Block head="Scheduled" mini={count(total, 'item') + (pastCount > 0 ? ` · ${pastCount} on past dates` : '')}>
      {scheduled.inWeek.map((group, i) => (
        <Fragment key={group.date}>
          <div className="sky-igroup" style={i === 0 ? { paddingTop: 2 } : undefined}>
            {weekdayOf(group.date)}, {monthDay(group.date)}
          </div>
          {rows(group, false)}
        </Fragment>
      ))}
      {scheduled.later.length > 0 && (
        <>
          <div className="sky-igroup">Later</div>
          {scheduled.later.map((group) => (
            <Fragment key={group.date}>{rows(group, true)}</Fragment>
          ))}
        </>
      )}
      {scheduled.past.length > 0 && (
        <>
          <div className="sky-igroup" data-tone="warn">
            Past dates, never landed
          </div>
          {scheduled.past.map((group) => (
            <Fragment key={group.date}>{rows(group, true)}</Fragment>
          ))}
        </>
      )}
    </Block>
  )
}

const NEXT_FOLD = 6

/** The backlog: the Next lists, folded, each line one move from the queue. */
function NextBlock({ next, actions }: { next: NonNullable<WeekData['queue']>['next']; actions: QueueActions }) {
  const [open, setOpen] = useState(false)
  const total = next.professional.length + next.personal.length + next.content.length
  if (total === 0) return null
  const rows = (items: NextItem[]) =>
    items.map((item) => (
      <div className="sky-qrow" key={`${item.file} ${item.list} ${item.raw}`}>
        {item.link ? (
          <a href={item.link} target="_blank" rel="noreferrer">
            {item.text}
          </a>
        ) : (
          <span>{item.text}</span>
        )}
        {item.link && <span className="sky-from">link</span>}
        <button type="button" className="sky-mv" onClick={() => actions.promote(item.file, item.list, item.raw)}>
          Next week ›
        </button>
      </div>
    ))
  const folded = !open && next.professional.length > NEXT_FOLD + 2
  const professional = folded ? next.professional.slice(0, NEXT_FOLD) : next.professional
  return (
    <Block head="Next" mini={count(total, 'item')}>
      {next.professional.length > 0 && (
        <>
          <div className="sky-igroup" style={{ paddingTop: 2 }}>
            Professional
          </div>
          {rows(professional)}
          {folded && (
            <div className="sky-fold-line">
              <span style={{ flex: 'none' }}>{next.professional.length - NEXT_FOLD} more</span>
              <button type="button" className="sky-showlink" onClick={() => setOpen(true)}>
                Show all
              </button>
            </div>
          )}
        </>
      )}
      {next.personal.length > 0 && (
        <>
          <div className="sky-igroup">Personal</div>
          {rows(next.personal)}
        </>
      )}
      {next.content.length > 0 && (
        <>
          <div className="sky-igroup">Content</div>
          {rows(next.content)}
        </>
      )}
    </Block>
  )
}

export function WeekMain({
  id,
  onOpenDay,
  onOpenWeek,
  onChanged,
}: {
  /** The week's id, or '' for this week */
  id: string
  /** A day row opened: today's page or a day's */
  onOpenDay: (ymd: string, today: boolean) => void
  onOpenWeek: (id: string) => void
  /** The notebook changed under a button — the shell re-reads what it shows of the week */
  onChanged?: () => void
}) {
  const { view, setView } = useWeek(id)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  /** A write to the week routes; the fresh view lands, or the reason it did not. */
  const send = async (key: string, route: string, body?: unknown): Promise<boolean> => {
    if (!view) return false
    setBusy(key)
    setNote(null)
    try {
      const response = await fetch(`${api(view.id)}${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const json = (await response.json().catch(() => null)) as (WeekData & { error?: string }) | null
      if (!response.ok || !json || json.error) {
        setNote(json?.error ?? `That did not go through (${response.status}).`)
        return false
      }
      setView(json)
      onChanged?.()
      return true
    } catch {
      setNote('The service did not answer.')
      return false
    } finally {
      setBusy(null)
    }
  }

  const actions: QueueActions = {
    busy,
    add: (text, category, day) => send('add', '/queue', { text, category, ...(day ? { day } : {}) }),
    remove: (file, list, raw) => void send(`remove:${raw}`, '/queue/remove', { file, list, raw }),
    promote: (file, list, raw) => void send(`promote:${raw}`, '/queue/promote', { file, list, raw }),
  }

  const title = view ? `Week ${view.number} · ${rangeLabel(view.start, view.end)}` : 'Week'
  const showDays = view ? view.exists || view.current : false

  return (
    <div className="sky-main sky-week">
      <header className="sky-head">
        {view && (
          <Button size="sm" onClick={() => onOpenWeek(view.current ? view.previous : '')} style={{ marginLeft: -10 }}>
            ‹ {view.current ? 'Last week' : 'This week'}
          </Button>
        )}
        <span className="sky-title">{title}</span>
        <nav className="sky-tabs">
          {view && !view.exists && !view.current && (
            <Button size="sm" loading={busy === 'create'} onClick={() => void send('create', '/create')}>
              Create the week
            </Button>
          )}
          {view?.plan && (
            <Button size="sm" component="a" href={fileHref(view.plan.path)}>
              Plan
            </Button>
          )}
          {view?.checkins && (
            <Button size="sm" component="a" href={fileHref(view.checkins.path)}>
              Check-ins
            </Button>
          )}
        </nav>
      </header>

      <div className="sky-scroll">
        <div className="sky-col">
          {note && <div className="sky-wnote">{note}</div>}
          {view && showDays && (
            <DaysBlock
              days={view.days}
              busy={busy}
              onOpenDay={(d) => onOpenDay(d.ymd, d.today)}
              onStart={(d) => void send(`start:${d.ymd}`, `/day/${d.ymd}/start`)}
              onEnd={(d) => void send(`end:${d.ymd}`, `/day/${d.ymd}/end`)}
            />
          )}
          {view?.queue && <QueueBlock queue={view.queue} days={view.days} actions={actions} />}
          {view?.queue && <ScheduledBlock scheduled={view.queue.scheduled} actions={actions} />}
          {view?.queue && <NextBlock next={view.queue.next} actions={actions} />}
          {view?.plan && <PlanBlock plan={view.plan} />}
          {view && !view.plan && (view.current || view.future) && (
            <Block head="Plan" mini="not written yet">
              <div className="sky-wempty">
                No plan yet. The week is planned in the terminal for now
                {view.queue ? '; everything above is what the planning draws from.' : '.'}
              </div>
            </Block>
          )}
          {view?.checkins && <CheckinBlock checkins={view.checkins} />}
        </div>
      </div>
    </div>
  )
}
