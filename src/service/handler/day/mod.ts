/**
 * The day the threads live in — what the day-first shell renders around
 * its conversations. Nothing here is new to the notebook: the Today
 * section is the home page's, the day's saved chats are the store's, and
 * the days are the notebook's own layout walked backwards.
 */

import * as path from 'node:path'
import { Hono } from 'hono'
import { exists, readTextFile, writeTextFile } from '#shared/fs/mod.ts'
import { listDayChats } from '#shared/models/Chat/ChatStore/mod.ts'
import { dayDir, dayFile, fetchNowSync } from '#shared/nbfs/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { buildTodaySection, formatDateLabel, type TodaySection } from '../home/today.ts'
import { buildDayRecord, type DayRecord, loadOwnerNames } from './record.ts'
import { toggleDayItem } from './toggle.ts'

export interface DayRoutesOptions {
  /** The notebook root that saved-chat paths are shown relative to */
  markdownBaseDir: string
  /** Notebook time root — where a day's chats are filed */
  timeDir: string
  /** about-me.md — the owner's names, for telling involved messages from archival ones */
  aboutMePath?: string
  /** Test seam — production reads the notebook clock */
  today?: () => PlainDate
  /** Test seam — production reads about-me.md */
  ownerNames?: string[]
}

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
  exchanges: number
}

export interface DayView {
  today: DayRef
  /** The day on the page — today unless a past day was asked for */
  day: DayRef & { dateLabel: string }
  /** Today and the six days before it, newest first */
  days: DayRef[]
  /** The home page's Today section; null on a past day, or when the clock is unavailable */
  section: TodaySection | null
  /** Chats already filed under the day */
  chats: SavedChatSummary[]
  /** The day's plan, promises, meetings, messages, and what got done */
  record: DayRecord
}

const DAYS_BACK = 6

async function dayRef(day: PlainDate, offset: number, options: DayRoutesOptions): Promise<DayRef> {
  const label = offset === 0 ? 'Today' : offset === 1 ? 'Yesterday' : day.dayLong
  const file = path.join(options.timeDir, dayFile(day))
  const dayRelativePath = (await exists(file)) ? path.relative(options.markdownBaseDir, file) : null
  return { ymd: day.ymd, label, meta: `${day.dayShort} ${day.ymd.slice(5)}`, dayRelativePath }
}

/** The view of one day: today by default, or the day named by `ymd`. */
export async function buildDayView(options: DayRoutesOptions, ymd?: string): Promise<DayView> {
  const today = (options.today ?? (() => fetchNowSync().plainDateTime.plainDate))()
  const day = ymd ? new PlainDate(ymd) : today
  const isToday = day.ymd === today.ymd
  const days = await Promise.all(
    Array.from({ length: DAYS_BACK + 1 }, (_, offset) => dayRef(today.addDays(-offset), offset, options)),
  )
  const ref = days.find((d) => d.ymd === day.ymd) ?? (await dayRef(day, DAYS_BACK + 1, options))

  const dayDirPath = path.join(options.timeDir, dayDir(day))
  const [section, saved, record] = await Promise.all([
    isToday ? buildTodaySection(options.markdownBaseDir) : null,
    listDayChats(path.join(dayDirPath, 'actions', 'ai-chats')),
    buildDayRecord({
      day,
      timeDir: options.timeDir,
      dayDirPath,
      markdownBaseDir: options.markdownBaseDir,
      ownerNames: options.ownerNames ?? (await loadOwnerNames(options.aboutMePath)),
    }),
  ])
  const chats = saved.map((c) => ({
    path: path.relative(options.markdownBaseDir, c.path),
    time: c.time,
    summary: c.summary,
    exchanges: c.exchanges,
  }))

  return { today: days[0], day: { ...ref, dateLabel: formatDateLabel(day) }, days, section, chats, record }
}

const YMD = /^\d{4}-\d{2}-\d{2}$/

/** A real calendar day in `YYYY-MM-DD` form — `2026-13-45` is not one. */
function isDay(ymd: string): boolean {
  if (!YMD.test(ymd)) return false
  try {
    return new PlainDate(ymd).ymd === ymd
  } catch {
    return false
  }
}

export function createDayRoutes(options: DayRoutesOptions): Hono {
  const app = new Hono()
  app.get('/', async (c) => c.json(await buildDayView(options)))
  app.get('/:ymd', async (c) => {
    const ymd = c.req.param('ymd')
    if (!isDay(ymd)) return c.json({ error: `not a day: ${ymd}` }, 404)
    return c.json(await buildDayView(options, ymd))
  })
  // The day view's checkbox: mark one list item done (strike) or not (un-strike),
  // then answer with the fresh view so the client renders what the file now says.
  app.post('/:ymd/item', async (c) => {
    const ymd = c.req.param('ymd')
    if (!isDay(ymd)) return c.json({ error: `not a day: ${ymd}` }, 404)
    const body = (await c.req.json().catch(() => null)) as { list?: unknown; raw?: unknown; done?: unknown } | null
    if (!body || typeof body.list !== 'string' || typeof body.raw !== 'string' || typeof body.done !== 'boolean') {
      return c.json({ error: 'expected {list, raw, done}' }, 400)
    }
    const file = path.join(options.timeDir, dayFile(new PlainDate(ymd)))
    if (!(await exists(file))) return c.json({ error: `no day file for ${ymd}` }, 404)
    const result = toggleDayItem(await readTextFile(file), body.list, body.raw, body.done)
    if (result.kind === 'missing') return c.json({ error: 'no such item — the day changed under the view' }, 404)
    if (result.kind === 'written') await writeTextFile(file, result.content)
    return c.json(await buildDayView(options, ymd))
  })
  return app
}
