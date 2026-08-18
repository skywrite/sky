import * as path from 'node:path'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'

/**
 * Where in the time tree a document lives, with the date span that level
 * covers. Day documents span a single day; week-, month-, and year-level
 * documents (a week plan, a week summary) span every day of their period.
 */
export type TimePathInfo =
  | { kind: 'day'; date: PlainDate; start: PlainDate; end: PlainDate }
  | { kind: 'week'; start: PlainDate; end: PlainDate }
  | { kind: 'month'; start: PlainDate; end: PlainDate }
  | { kind: 'year'; start: PlainDate; end: PlainDate }

const YEAR_DIR = /^\d{4}$/
const MONTH_DIR = /^\d{2}$/
// Week dirs (DD-DD) and day dirs (MM-DD) share this shape; position tells them apart.
const RANGE_DIR = /^(\d{2})-(\d{2})$/

/**
 * Classify a time-tree document path and derive the date span it covers.
 *
 * The tree nests time/YYYY/MM/DD-DD/MM-DD/**, and a document's depth is its
 * granularity: a file inside a day dir is a day document, a file directly in
 * the week-range dir (week.md, summary.md) is a week document, and so on up.
 * Total over all inputs — a path outside the time tree, a bare directory
 * path, or a malformed component returns null rather than throwing. This is
 * the tolerant counterpart to parseDateFromDayPath's day-files-only contract.
 *
 * @example
 * parseTimePath('/nb/time/2022/03/21-27/03-21/day.md')
 * // { kind: 'day', date: 2022-03-21, start: 2022-03-21, end: 2022-03-21 }
 *
 * @example
 * parseTimePath('/nb/time/2022/03/28-03/week.md')
 * // { kind: 'week', start: 2022-03-28, end: 2022-04-03 } — cross-month span
 */
export default function parseTimePath(filePath: string): TimePathInfo | null {
  const parts = filePath.split(path.sep)
  const timeIndex = parts.indexOf('time')
  if (timeIndex === -1) return null

  const rest = parts.slice(timeIndex + 1)
  // 'time' itself or a bare year dir — no document here.
  if (rest.length < 2) return null

  const [yearStr, second, third, fourth] = rest
  if (!YEAR_DIR.test(yearStr)) return null
  const year = parseInt(yearStr, 10)

  // PlainDate validates its components — a well-shaped path naming an
  // impossible date (month 13, Feb 30) classifies as null, not a crash.
  try {
    // time/YYYY/<file> — a year-level document
    if (rest.length === 2) {
      if (MONTH_DIR.test(second)) return null // bare month dir path
      return { kind: 'year', start: new PlainDate(year, 1, 1), end: new PlainDate(year, 12, 31) }
    }

    if (!MONTH_DIR.test(second)) return null
    const month = parseInt(second, 10)

    // time/YYYY/MM/<file> — a month-level document
    if (rest.length === 3) {
      if (RANGE_DIR.test(third)) return null // bare week dir path
      const start = new PlainDate(year, month, 1)
      const end = (month === 12 ? new PlainDate(year + 1, 1, 1) : new PlainDate(year, month + 1, 1)).addDays(-1)
      return { kind: 'month', start, end }
    }

    const week = third.match(RANGE_DIR)
    if (!week) return null

    // time/YYYY/MM/DD-DD/<file> — a week-level document
    if (rest.length === 4) {
      if (RANGE_DIR.test(fourth)) return null // bare day dir path
      const start = new PlainDate(year, month, parseInt(week[1], 10))
      const end = weekEnd(start, parseInt(week[2], 10))
      return end ? { kind: 'week', start, end } : null
    }

    // time/YYYY/MM/DD-DD/MM-DD/** — a day document. The day dir carries its
    // own month, so cross-month spillover days are self-describing.
    const day = fourth.match(RANGE_DIR)
    if (!day) return null
    const date = new PlainDate(year, parseInt(day[1], 10), parseInt(day[2], 10))
    return { kind: 'day', date, start: date, end: date }
  } catch {
    return null
  }
}

/**
 * Resolve a week dir's end day against its start. Week dirs clip at year
 * boundaries (26-31, 01-01), so spans run 1–7 days, and an end day smaller
 * than the start day means the week spills into the next month. Walking the
 * span finds the end without month arithmetic and rejects ranges no real
 * week produces.
 */
function weekEnd(start: PlainDate, endDay: number): PlainDate | null {
  for (let end = start, i = 0; i < 7; i++, end = end.addDays(1)) {
    if (end.day === endDay) return end
  }
  return null
}
