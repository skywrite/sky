/**
 * The day the threads live in — what the day-first shell renders around
 * its conversations. The day's saved chats are the store's, and the days
 * are the notebook's own layout walked backwards. Streaks have their own
 * report, shared by the day check-ins and the history page.
 */

import * as path from 'node:path'
import { Hono } from 'hono'
import type { MostImportantAI } from '#lib/mostImportant/types.ts'
import { planningDate } from '#lib/nbfs/taskDestination.ts'
import { OutboxError } from '#lib/outbox/types.ts'
import { resolveWorkstreamDayItems } from '#lib/workstreams/day.ts'
import type { WorkstreamStore } from '#lib/workstreams/store.ts'
import { WorkstreamError } from '#lib/workstreams/types.ts'
import { exists } from '#shared/fs/mod.ts'
import { listDayChats } from '#shared/models/Chat/ChatStore/mod.ts'
import { dayAIChatsDir, dayDir, dayFile, fetchNowSync } from '#shared/nbfs/mod.ts'
import { PlainDate, type ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { formatDateLabel } from '../home/today.ts'
import { buildDayEnding, type DayEnding } from './ending.ts'
import { createDayFilesRoutes, type DayFilesOptions } from './files.ts'
import isDay from './isDay.ts'
import { createItemRoutes } from './item.ts'
import type { ItemRoutesOptions } from './itemContext.ts'
import { createMostImportantRoutes } from './mostImportant.ts'
import { buildDayRecord, type DayRecord, loadOwnerNames } from './record.ts'
import { createScheduleRoutes, type ScheduleHost } from './schedule.ts'
import { readDaySummary, type DaySummary } from './summary.ts'

export interface DayRoutesOptions {
  /** The notebook root that saved-chat paths are shown relative to */
  markdownBaseDir: string
  /** Notebook time root — where a day's chats are filed */
  timeDir: string
  /** about-me.md — the owner's names, for telling involved messages from archival ones */
  aboutMePath?: string
  /** Test seam — production reads the notebook clock */
  today?: () => PlainDate
  planningToday?: () => PlainDate
  /** The notebook clock itself, for the hour past midnight; production reads it, tests script it */
  now?: () => ZonedDateTime
  /** Runs day:start and day:end for the page's buttons; without it the two routes stay off */
  commands?: DayCommands
  /** Test seam — production reads about-me.md */
  ownerNames?: string[]
  /** The owner's email addresses: each connected Google account and its Gmail aliases */
  ownerAddresses?: () => Promise<string[]>
  /** The day's files live under the user-data directory; without it the files routes stay off */
  files?: DayFilesOptions
  /** The day's calendar schedule for the rail; without it the schedule route stays off */
  schedule?: ScheduleHost
  workstreams?: WorkstreamStore
  /** Test seam for a failed planning write. */
  writePlanning?: ItemRoutesOptions['writePlanning']
  mostImportant?: MostImportantAI
}

/** The day commands the pages run in-process — each exactly as the terminal runs it. */
export interface DayCommands {
  /** day:start for the day waiting to begin, run the moment Start is pressed */
  startDay: (day: PlainDate) => Promise<void>
  /** day:end, run the moment End is pressed */
  endDay: (day: PlainDate, options?: { perfect?: boolean }) => Promise<void>
}

/**
 * The day waiting to be started: the calendar's date, once the notebook clock
 * has run past 24:00 on the day still open. Until the next start, the open day
 * keeps everything that files — so the pages say so, and offer the start.
 */
export interface DayDue {
  ymd: string
  /** Monday … Sunday */
  weekday: string
  /** `Friday, September 27, 2030` */
  dateLabel: string
  /** Before 04:00 on the new date: a late night, not a morning, so the page only whispers */
  night: boolean
}

/** The hour the night ends — the same boundary a day with no start is assumed to begin at. */
const NIGHT_ENDS = 4

/** A day in the sidebar: what to call it, and the short stamp beside it. */
export interface DayRef {
  ymd: string
  /** "Today", "Yesterday", else the weekday */
  label: string
  /** `Fri 08-01` — the stamp beside the label */
  meta: string
  /** The day file, relative to the notebook root; null when the day has none yet */
  dayRelativePath: string | null
}

export interface SavedChatSummary {
  /** Relative to the notebook root */
  path: string
  time: string
  summary: string
  /** Complete exchanges the file itself holds */
  exchanges: number
  /** The chat this one branched from (relative to the notebook root) and the turn it left after; null for a chat that began on its own */
  parent: { chat: string; turn: number } | null
}

export interface DayView {
  today: DayRef
  /** Calendar date used by task date pickers and the scheduling boundary. */
  planningToday?: string
  /** The day waiting to be started; null while the clock and the calendar agree */
  due: DayDue | null
  /** The day on the page — today unless a past day was asked for */
  day: DayRef & { dateLabel: string }
  /** Today and the six days before it, newest first */
  days: DayRef[]
  /** Legacy homepage field; streak check-ins now use the dedicated streak report. */
  section: null
  /** Chats already filed under the day */
  chats: SavedChatSummary[]
  /** The day's plan, promises, meetings, messages, and what got done */
  record: DayRecord
  /** The saved summary's opening and meaningful moments, when the file exists. */
  summary: DaySummary | null
}

const DAYS_BACK = 6

async function dayRef(day: PlainDate, offset: number, options: DayRoutesOptions): Promise<DayRef> {
  const label = offset === 0 ? 'Today' : offset === 1 ? 'Yesterday' : day.dayLong
  const file = path.join(options.timeDir, dayFile(day))
  const dayRelativePath = (await exists(file)) ? path.relative(options.markdownBaseDir, file) : null
  return { ymd: day.ymd, label, meta: `${day.dayShort} ${day.ymd.slice(5)}`, dayRelativePath }
}

/** The notebook clock: the last started day, with hours past 24 until the next start. Null when no day was ever started. */
function readClock(options: DayRoutesOptions): ZonedDateTime | null {
  try {
    return (options.now ?? (() => fetchNowSync({ timeDir: options.timeDir })))()
  } catch {
    return null
  }
}

function notebookToday(options: DayRoutesOptions): PlainDate {
  if (options.today) return options.today()
  return readClock(options)?.plainDateTime.plainDate ?? PlainDate.today()
}

function planningToday(options: DayRoutesOptions): PlainDate {
  if (options.planningToday) return options.planningToday()
  if (options.today && !options.now) return options.today()
  const now = readClock(options)
  return now ? planningDate(now) : PlainDate.today()
}

/** The calendar day waiting to be started, when the clock has moved past the notebook's day. */
function dueDay(options: DayRoutesOptions, today: PlainDate): DayDue | null {
  const due = planningToday(options)
  if (PlainDate.compare(due, today) <= 0) return null
  const hour = Number(readClock(options)?.time.split(':')[0] ?? NIGHT_ENDS)
  return { ymd: due.ymd, weekday: due.dayLong, dateLabel: formatDateLabel(due), night: hour % 24 < NIGHT_ENDS }
}

/** The view of one day: today by default, or the day named by `ymd`. */
export async function buildDayView(options: DayRoutesOptions, ymd?: string): Promise<DayView> {
  const today = notebookToday(options)
  const day = ymd ? new PlainDate(ymd) : today
  const days = await Promise.all(
    Array.from({ length: DAYS_BACK + 1 }, (_, offset) => dayRef(today.addDays(-offset), offset, options)),
  )
  const ref = days.find((d) => d.ymd === day.ymd) ?? (await dayRef(day, DAYS_BACK + 1, options))

  const dayDirPath = path.join(options.timeDir, dayDir(day))
  const [saved, record, summary] = await Promise.all([
    listDayChats(path.join(options.timeDir, dayAIChatsDir(day))),
    buildDayRecord({
      day,
      timeDir: options.timeDir,
      dayDirPath,
      markdownBaseDir: options.markdownBaseDir,
      ownerNames: options.ownerNames ?? (await loadOwnerNames(options.aboutMePath)),
      ownerAddresses: await options.ownerAddresses?.(),
    }),
    readDaySummary(dayDirPath, options.markdownBaseDir),
  ])
  const chats = saved
    .filter((c) => c.parent?.kind !== 'thread')
    .map((c) => ({
      path: path.relative(options.markdownBaseDir, c.path),
      time: c.time,
      summary: c.summary,
      exchanges: c.exchanges,
      parent: c.parent,
    }))

  if (options.workstreams) {
    for (const key of ['mostImportant', 'commitments', 'todos', 'reminders', 'done'] as const) {
      record[key] = await resolveWorkstreamDayItems(
        options.workstreams,
        day.ymd,
        record.ended ? null : today.ymd,
        record[key],
      )
    }
  }

  return {
    today: days[0],
    planningToday: planningToday(options).ymd,
    due: dueDay(options, today),
    day: { ...ref, dateLabel: formatDateLabel(day) },
    days,
    section: null,
    chats,
    record,
    summary,
  }
}

/** What the End dialog shows for one day: the records missing an end time. */
function dayEnding(options: DayRoutesOptions, day: PlainDate): Promise<DayEnding> {
  return buildDayEnding({
    dayDirPath: path.join(options.timeDir, dayDir(day)),
    markdownBaseDir: options.markdownBaseDir,
  })
}

export function createDayRoutes(options: DayRoutesOptions): Hono {
  const app = new Hono()
  app.onError((error, c) =>
    c.json(
      { error: error.message },
      error instanceof WorkstreamError || error instanceof OutboxError ? error.status : 500,
    ),
  )
  app.get('/', async (c) => c.json(await buildDayView(options)))
  app.get('/:ymd', async (c) => {
    const ymd = c.req.param('ymd')
    if (!isDay(ymd)) return c.json({ error: `not a day: ${ymd}` }, 404)
    return c.json(await buildDayView(options, ymd))
  })
  // Poll just the saved file while reading; the rest of the day's record need not be rebuilt.
  app.get('/:ymd/summary', async (c) => {
    const ymd = c.req.param('ymd')
    if (!isDay(ymd)) return c.json({ error: `not a day: ${ymd}` }, 404)
    const dir = path.join(options.timeDir, dayDir(new PlainDate(ymd)))
    return c.json({ summary: await readDaySummary(dir, options.markdownBaseDir) })
  })
  // Ending the day: what the End dialog shows, then day:end the moment End is pressed.
  app.get('/:ymd/end', async (c) => {
    const ymd = c.req.param('ymd')
    if (!isDay(ymd)) return c.json({ error: `not a day: ${ymd}` }, 404)
    return c.json(await dayEnding(options, new PlainDate(ymd)))
  })
  const commands = options.commands
  if (commands) {
    // Starting the day that is waiting: day:start the moment Start is pressed, as the week page runs it.
    app.post('/:ymd/start', async (c) => {
      const ymd = c.req.param('ymd')
      if (!isDay(ymd)) return c.json({ error: `not a day: ${ymd}` }, 404)
      const view = await buildDayView(options, ymd)
      if (view.record.started) return c.json({ error: 'This day has already started.', view }, 409)
      if (ymd > planningToday(options).ymd)
        return c.json({ error: `${new PlainDate(ymd).dayLong} has not come yet.`, view }, 409)
      try {
        await commands.startDay(new PlainDate(ymd))
      } catch (error) {
        return c.json({ error: (error as Error).message, view: await buildDayView(options, ymd) }, 422)
      }
      return c.json(await buildDayView(options, ymd))
    })
    app.post('/:ymd/end', async (c) => {
      const ymd = c.req.param('ymd')
      if (!isDay(ymd)) return c.json({ error: `not a day: ${ymd}` }, 404)
      const view = await buildDayView(options, ymd)
      if (view.record.ended) return c.json({ error: 'This day has already ended.', view }, 409)
      if (!view.record.started)
        return c.json({ error: 'This day never started, so it has no end to record.', view }, 409)
      const body = (await c.req.json().catch(() => null)) as { perfect?: unknown } | null
      const perfect = body?.perfect
      if (perfect !== undefined && typeof perfect !== 'boolean')
        return c.json({ error: 'Perfect day must be true or false.', view }, 400)
      try {
        await commands.endDay(new PlainDate(ymd), { perfect: perfect ?? true })
      } catch (error) {
        return c.json({ error: (error as Error).message, view: await buildDayView(options, ymd) }, 422)
      }
      return c.json(await buildDayView(options, ymd))
    })
  }
  // The day view's writes to one item — checkbox, delete, undo — each answering with the fresh view.
  app.route(
    '/',
    createItemRoutes({
      timeDir: options.timeDir,
      markdownBaseDir: options.markdownBaseDir,
      stateDir: options.files ? path.join(options.files.userDataDir, 'day-planning') : undefined,
      writePlanning: options.writePlanning,
      today: () => planningToday(options),
      view: (ymd) => buildDayView(options, ymd),
      workstreams: options.workstreams,
    }),
  )
  // The day's files: listed, served, kept from a drop, put back, removed.
  if (options.files) app.route('/', createDayFilesRoutes(options.files))
  // The day's schedule: the calendar's meetings against the notebook clock, for the rail.
  if (options.schedule) app.route('/', createScheduleRoutes(options.schedule))
  app.route(
    '/',
    createMostImportantRoutes({
      timeDir: options.timeDir,
      markdownBaseDir: options.markdownBaseDir,
      stateDir: options.files ? path.join(options.files.userDataDir, 'day-planning') : undefined,
      writePlanning: options.writePlanning,
      today: options.today ?? (() => fetchNowSync().plainDateTime.plainDate),
      view: (ymd) => buildDayView(options, ymd),
      workstreams: options.workstreams,
      ai: options.mostImportant,
    }),
  )
  return app
}
