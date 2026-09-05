/**
 * The week the days live in — what the week page renders. Nothing here is
 * new to the notebook: the days are the week's day files read for their
 * started and ended stamps, the plan is week.md, the check-ins are
 * checkins.md, and what waits for a week that has no plan yet is the
 * standing next and schedule files at the top of time/.
 *
 * Time is the notebook's own. The notebook clock runs in the started
 * day's zone with hours past 24 until the next day starts, so the day
 * waiting to be started is the clock's calendar date when it has moved
 * past the notebook's day — 30:52 on Thursday is Friday, due. This week
 * is the week of that calendar day.
 */

import * as path from 'node:path'
import { type Context, Hono } from 'hono'
import { exists, readTextFile } from '#shared/fs/mod.ts'
import { dayFile, fetchNowSync, readDay, weekDir } from '#shared/nbfs/mod.ts'
import { PlainDate, Week, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import isDay from '../day/isDay.ts'
import { type CheckinGoal, parseCheckins, statusesFor, type WeekCheckins } from './checkins.ts'
import { parseWeekPlan, type PlanGoal, type WeekPlan } from './plan.ts'
import {
  addQueueItem,
  addScheduledItem,
  isQueueFile,
  isScheduleFile,
  promoteItem,
  readWeekQueue,
  removeItem,
  type WeekQueue,
} from './queue.ts'

/** The commands the page can run; production runs them in-process, tests script them. */
export interface WeekCommands {
  /** day:start for the day waiting to begin */
  startDay: (day: PlainDate) => Promise<void>
  /** day:end for a day that was never ended */
  endDay: (day: PlainDate) => Promise<void>
  /** week:new for a week whose files do not exist yet */
  createWeek: (week: Week) => Promise<void>
}

export interface WeekRoutesOptions {
  /** The notebook root that file paths are shown relative to */
  markdownBaseDir: string
  /** Notebook time root — the week directories and the standing files */
  timeDir: string
  /** The notebook clock — production reads the last started day; tests script it */
  now?: () => ZonedDateTime
  /** Without a host the start, end and create routes are not served */
  commands?: WeekCommands
}

export type DayState =
  /** Started and ended */
  | 'ended'
  /** The notebook's current day, still going */
  | 'running'
  /** Started, never ended, and the calendar has moved past it */
  | 'open'
  /** The calendar day, waiting to be started */
  | 'due'
  /** A day that came and went without starting */
  | 'blank'
  /** Not yet */
  | 'upcoming'

export interface WeekDayRow {
  ymd: string
  /** Monday … Sunday */
  weekday: string
  exists: boolean
  /** `HH:MM` from the day file */
  started: string | null
  ended: string | null
  perfect: boolean
  /** The notebook's current day */
  today: boolean
  state: DayState
  /** The day file, relative to the notebook root; null when the day has none */
  dayRelativePath: string | null
}

export interface PlanGoalView extends PlanGoal {
  /** What the latest check-in said about this goal, when it named it */
  status: CheckinGoal | null
}

export interface WeekPlanView extends Omit<WeekPlan, 'goals'> {
  /** week.md, relative to the notebook root */
  path: string
  goals: PlanGoalView[]
}

export interface WeekCheckinsView extends WeekCheckins {
  /** checkins.md, relative to the notebook root */
  path: string
}

export interface WeekView {
  /** `2026-W36` */
  id: string
  year: number
  number: number
  /** Monday and Sunday, `YYYY-MM-DD` */
  start: string
  end: string
  /** The week of the calendar day */
  current: boolean
  /** Entirely after the calendar day */
  future: boolean
  /** The week directory exists */
  exists: boolean
  thisWeek: string
  previous: string
  next: { id: string; exists: boolean; planned: boolean }
  /** The day waiting to be started, when the calendar has moved past the notebook's day */
  due: { ymd: string; weekday: string } | null
  days: WeekDayRow[]
  plan: WeekPlanView | null
  checkins: WeekCheckinsView | null
  /** What waits for a week that is still ahead; null on the current and past weeks */
  queue: WeekQueue | null
}

const WEEK_ID = /^\d{4}-W\d{2}$/

interface Clock {
  /** The notebook's day — the last started day */
  notebookDay: PlainDate
  /** The clock's calendar date in the started day's zone — the day after 24:00 */
  calendarDay: PlainDate
  thisWeek: Week
}

/** The notebook clock read once per request; a notebook with no started day falls back to the machine's date. */
function readClock(options: WeekRoutesOptions): Clock {
  let now: ZonedDateTime
  try {
    now = (options.now ?? fetchNowSync)()
  } catch {
    now = new ZonedDateTime()
  }
  const notebookDay = now.plainDateTime.plainDate
  const hours = Number(now.time.split(':')[0])
  const calendarDay = notebookDay.addDays(Math.floor(hours / 24))
  return { notebookDay, calendarDay, thisWeek: Week.of(calendarDay) }
}

async function dayRow(day: PlainDate, clock: Clock, options: WeekRoutesOptions): Promise<WeekDayRow> {
  const file = path.join(options.timeDir, dayFile(day))
  const fileExists = await exists(file)
  let started: string | null = null
  let ended: string | null = null
  let perfect = false
  if (fileExists) {
    try {
      const doc = await readDay(day, options.timeDir)
      started = doc.started?.time ?? null
      ended = doc.ended?.time ?? null
      perfect = doc.yaml['perfect'] === true
    } catch {
      // An unreadable day file is a day with nothing to say
    }
  }
  const cmp = PlainDate.compare(day, clock.calendarDay)
  const state: DayState =
    started && ended
      ? 'ended'
      : started && cmp < 0
        ? 'open'
        : started
          ? 'running'
          : cmp === 0
            ? 'due'
            : cmp > 0
              ? 'upcoming'
              : 'blank'
  return {
    ymd: day.ymd,
    weekday: day.dayLong,
    exists: fileExists,
    started,
    ended,
    perfect,
    today: day.ymd === clock.notebookDay.ymd,
    state,
    dayRelativePath: fileExists ? path.relative(options.markdownBaseDir, file) : null,
  }
}

/** The view of one week: the calendar day's week by default, or the week named by `id`. */
export async function buildWeekView(options: WeekRoutesOptions, id?: string): Promise<WeekView> {
  const clock = readClock(options)
  const week = id ? Week.parse(id) : clock.thisWeek
  const dir = path.join(options.timeDir, weekDir(week.startInYear))
  const nextWeek = week.next()
  const nextDir = path.join(options.timeDir, weekDir(nextWeek.startInYear))

  const days = await Promise.all(week.days.map((day) => dayRow(day, clock, options)))
  const dueRow = days.find((row) => row.state === 'due')
  const dueDay = clock.calendarDay
  const dueOutsideWeek =
    !dueRow && !days.some((row) => row.ymd === dueDay.ymd) && !(await startedOn(dueDay, options.timeDir))
  const due = dueRow || dueOutsideWeek ? { ymd: dueDay.ymd, weekday: dueDay.dayLong } : null

  const planPath = path.join(dir, 'week.md')
  const checkinsPath = path.join(dir, 'checkins.md')
  const checkins: WeekCheckinsView | null = (await exists(checkinsPath))
    ? { ...parseCheckins(await readTextFile(checkinsPath)), path: path.relative(options.markdownBaseDir, checkinsPath) }
    : null
  let plan: WeekPlanView | null = null
  if (await exists(planPath)) {
    const parsed = parseWeekPlan(await readTextFile(planPath))
    const statuses = statusesFor(parsed.goals, checkins?.latest ?? null)
    plan = {
      ...parsed,
      path: path.relative(options.markdownBaseDir, planPath),
      goals: parsed.goals.map((goal, i) => ({ ...goal, status: statuses[i] })),
    }
  }

  const future = PlainDate.compare(week.start, clock.calendarDay) > 0
  return {
    id: week.toString(),
    year: week.year,
    number: week.number,
    start: week.start.ymd,
    end: week.end.ymd,
    current: week.equals(clock.thisWeek),
    future,
    exists: await exists(dir),
    thisWeek: clock.thisWeek.toString(),
    previous: week.previous().toString(),
    next: {
      id: nextWeek.toString(),
      exists: await exists(nextDir),
      planned: await exists(path.join(nextDir, 'week.md')),
    },
    due,
    days,
    plan,
    checkins,
    queue: future ? await readWeekQueue(options.timeDir, week, clock.calendarDay) : null,
  }
}

/** Whether the day's file carries a started stamp. */
async function startedOn(day: PlainDate, timeDir: string): Promise<boolean> {
  try {
    return Boolean((await readDay(day, timeDir)).started)
  } catch {
    return false
  }
}

/** The body as an object, or null when it is not one. */
async function bodyOf(c: Context): Promise<Record<string, unknown> | null> {
  const body = (await c.req.json().catch(() => null)) as unknown
  return body && typeof body === 'object' ? (body as Record<string, unknown>) : null
}

function isCategory(value: unknown): value is 'Professional' | 'Personal' {
  return value === 'Professional' || value === 'Personal'
}

export function createWeekRoutes(options: WeekRoutesOptions): Hono {
  const app = new Hono()

  /** The week the request names, or the refusal to send instead. */
  const weekOf = (c: Context): Week | Response => {
    const id = c.req.param('id') ?? ''
    if (!WEEK_ID.test(id)) return c.json({ error: `not a week: ${id}` }, 404)
    try {
      return Week.parse(id)
    } catch {
      return c.json({ error: `not a week: ${id}` }, 404)
    }
  }

  /** A command run, answered with the fresh view — or with what went wrong. */
  const command = async (c: Context, week: Week, run: (commands: WeekCommands) => Promise<void>) => {
    if (!options.commands) return c.json({ error: 'the service runs no commands here' }, 501)
    try {
      await run(options.commands)
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 502)
    }
    return c.json(await buildWeekView(options, week.toString()))
  }

  app.get('/', async (c) => c.json(await buildWeekView(options)))

  app.get('/:id', async (c) => {
    const week = weekOf(c)
    if (week instanceof Response) return week
    return c.json(await buildWeekView(options, week.toString()))
  })

  // The week's files, for a week that has none yet — the Sunday or Monday step, as a button.
  app.post('/:id/create', async (c) => {
    const week = weekOf(c)
    if (week instanceof Response) return week
    return command(c, week, (commands) => commands.createWeek(week))
  })

  // The day waiting to begin, and a day that was never ended.
  app.post('/:id/day/:ymd/start', async (c) => {
    const week = weekOf(c)
    if (week instanceof Response) return week
    const ymd = c.req.param('ymd')
    if (!isDay(ymd)) return c.json({ error: `not a day: ${ymd}` }, 404)
    return command(c, week, (commands) => commands.startDay(new PlainDate(ymd)))
  })

  app.post('/:id/day/:ymd/end', async (c) => {
    const week = weekOf(c)
    if (week instanceof Response) return week
    const ymd = c.req.param('ymd')
    if (!isDay(ymd)) return c.json({ error: `not a day: ${ymd}` }, 404)
    return command(c, week, (commands) => commands.endDay(new PlainDate(ymd)))
  })

  // Something for the week: into the queue, or under a day when one is picked.
  app.post('/:id/queue', async (c) => {
    const week = weekOf(c)
    if (week instanceof Response) return week
    const body = await bodyOf(c)
    const text = typeof body?.text === 'string' ? body.text.trim() : ''
    if (!text || !isCategory(body?.category)) return c.json({ error: 'expected {text, category, day?}' }, 400)
    const day = body.day
    if (day !== undefined) {
      if (typeof day !== 'string' || !isDay(day)) return c.json({ error: `not a day: ${String(day)}` }, 400)
      await addScheduledItem(options.timeDir, body.category, day, text)
    } else {
      await addQueueItem(options.timeDir, body.category, text, readClock(options).thisWeek.toString())
    }
    return c.json(await buildWeekView(options, week.toString()))
  })

  // The × on a queued, scheduled or backlog line.
  app.post('/:id/queue/remove', async (c) => {
    const week = weekOf(c)
    if (week instanceof Response) return week
    const body = await bodyOf(c)
    if (
      !(isQueueFile(body?.file) || isScheduleFile(body?.file)) ||
      typeof body.list !== 'string' ||
      typeof body.raw !== 'string'
    )
      return c.json({ error: 'expected {file, list, raw}' }, 400)
    const edit = await removeItem(options.timeDir, body.file, body.list, body.raw)
    if (edit === 'missing') return c.json({ error: 'no such line — the file changed under the page' }, 404)
    return c.json(await buildWeekView(options, week.toString()))
  })

  // A backlog line moves into the queue.
  app.post('/:id/queue/promote', async (c) => {
    const week = weekOf(c)
    if (week instanceof Response) return week
    const body = await bodyOf(c)
    if (!isQueueFile(body?.file) || typeof body.list !== 'string' || typeof body.raw !== 'string')
      return c.json({ error: 'expected {file, list, raw}' }, 400)
    const edit = await promoteItem(
      options.timeDir,
      body.file,
      body.list,
      body.raw,
      readClock(options).thisWeek.toString(),
    )
    if (edit === 'missing') return c.json({ error: 'no such line — the file changed under the page' }, 404)
    return c.json(await buildWeekView(options, week.toString()))
  })

  return app
}
