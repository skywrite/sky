import * as path from 'node:path'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import dayDir from './dayDir.ts'

// The universal time ref: `YYYY-MM-DD/subpath`.
//
// A notebook file has two names. The ref is its identity — the day it belongs
// to and its place under that day — and never changes. The path is where the
// current layout keeps that day, and has changed already (day dirs were DD,
// then xDD for cross-month spillover, now MM-DD). State that records paths
// fossilizes the layout of its writing day: most email follows point at day
// dirs that no longer exist. State should record refs and resolve them at
// read time, so the layout can keep moving underneath.
//
// `previous:` frontmatter, DocumentStore.resolveRef, and the vscode links
// already speak this syntax; these functions make it writable and resolvable
// everywhere else.

/** `YYYY-MM-DD/subpath` — the same shape DocumentStore.resolveRef accepts. */
const REGEX_REF = /^(?<year>\d{4})-(?<month>0[1-9]|1[0-2])-(?<day>0[1-9]|[12][0-9]|3[01])\/(?<subpath>.+)$/

/** Day-dir segment of a full path: MM-DD (v1.1), or legacy DD / xDD. */
const REGEX_DAY_DIR = /^(?:(?<month>0[1-9]|1[0-2])-)?(?<cross>x)?(?<day>0[1-9]|[12][0-9]|3[01])$/

const REGEX_WEEK_DIR = /^(?<first>[0-3][0-9])-(?<last>[0-3][0-9])$/

export function isTimeRef(value: string): boolean {
  return REGEX_REF.test(value)
}

/**
 * Canonicalize a stored location to a time ref. Refs pass through untouched;
 * full day paths — in any layout the notebook has ever written — reduce to
 * the date they encode plus the subpath below the day dir.
 *
 * Legacy forms are why this exists: a `DD` day dir carries no month of its
 * own, so the month comes from the path — except in a cross-month week
 * (`29-05`), where a day at or below the week's last day belongs to the month
 * after the path's, as does any `x`-marked spillover day. The date survives
 * even though the directory it names no longer does.
 *
 * Throws on a value that is neither — a stored location that cannot be read
 * as a ref is data damage to surface, never to guess around.
 */
export function toTimeRef(pathOrRef: string): string {
  if (isTimeRef(pathOrRef)) return pathOrRef

  const parts = pathOrRef.split(path.sep)
  const timeIndex = parts.indexOf('time')
  if (timeIndex === -1) {
    throw new Error(`Invalid time ref or day path: missing 'time' directory in ${pathOrRef}`)
  }

  const [yearStr, monthStr, weekStr, dayDirStr] = parts.slice(timeIndex + 1, timeIndex + 5)
  const subpath = parts.slice(timeIndex + 5).join('/')
  const dayMatch = dayDirStr?.match(REGEX_DAY_DIR)
  if (!/^\d{4}$/.test(yearStr ?? '') || !dayMatch?.groups || !subpath) {
    throw new Error(`Invalid time ref or day path: ${pathOrRef}`)
  }

  let year = parseInt(yearStr, 10)
  let month = parseInt(dayMatch.groups.month ?? monthStr, 10)
  const day = parseInt(dayMatch.groups.day, 10)
  if (!(month >= 1 && month <= 12)) {
    throw new Error(`Invalid time ref or day path: ${pathOrRef}`)
  }

  // Legacy cross-month: the week dir's month belongs to its first day, so in
  // a boundary-crossing week the tail days (and any xDD) sit one month later.
  if (!dayMatch.groups.month) {
    const week = weekStr?.match(REGEX_WEEK_DIR)
    const crossesMonth = week?.groups && parseInt(week.groups.first, 10) > parseInt(week.groups.last, 10)
    const spillsOver = crossesMonth && week?.groups && day <= parseInt(week.groups.last, 10)
    if (dayMatch.groups.cross || spillsOver) {
      month += 1
      if (month > 12) {
        month = 1
        year += 1
      }
    }
  }

  const date = new PlainDate(year, month, day)
  return `${date.yearPadded}-${date.monthPadded}-${date.dayPadded}/${subpath}`
}

/**
 * The current real path of a ref (or of a path in any older layout):
 * `time/<today's layout for that date>/<subpath>`. This is the read-time
 * half of the bargain — stored refs never change, and this function is the
 * only place that knows where a date lives now.
 */
export function resolveTimeRef(refOrPath: string): string {
  const ref = toTimeRef(refOrPath)
  const match = ref.match(REGEX_REF)
  if (!match?.groups) throw new Error(`Invalid time ref: ${refOrPath}`)
  const { year, month, day, subpath } = match.groups
  const date = new PlainDate(parseInt(year, 10), parseInt(month, 10), parseInt(day, 10))
  return path.join('time', dayDir(date), subpath)
}
