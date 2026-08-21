import * as path from 'node:path'
import { PlainDate, Week } from '#universal/dates/nbdt/mod.ts'
import { FILE_DAY } from '../dayFile.ts'
import normalizeToPlainDate from '../normalizeToPlainDate.ts'
import type { TimePathInfo } from '../parseTimePath.ts'
import type { NbfsLayout } from './types.ts'

// A week dir is "W14" or month-labeled "03-W14"; parsers accept both
// regardless of which variant is configured, so flipping the label is a
// rename migration, not a format break. Group 1 is the label, group 2 the
// sky week number.
const WEEK_DIR = /^(?:(\d{2})-)?W(\d{2})$/
const DAY_DIR = /^(\d{2})-(\d{2})$/
const YEAR_DIR = /^\d{4}$/

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * v2 - the year is the boundary and weeks are the only container:
 * YYYY/W##/MM-DD. Week numbers are sky weeks (see Week): ISO mid-year, with
 * W00/W53 as year-boundary buckets, so every day files under its own
 * calendar year and boundary weeks split honestly instead of lying about
 * their month or year.
 *
 * The month-labeled variant prefixes the week dir with the month of the
 * week's first in-year day ("03-W14", so W00 is always "01-W00"). It is a
 * scannable label, never a container - no file's location depends on it,
 * and no parser reads it.
 */
function makeV2(pattern: string, monthLabel: boolean): NbfsLayout {
  const weekDir = (date: PlainDate | string): string => {
    const d = normalizeToPlainDate(date)
    const week = Week.of(d)
    const name = `W${pad(week.number)}`
    const dirName = monthLabel ? `${pad(week.startInYear.month)}-${name}` : name
    return path.join(d.yearPadded, dirName)
  }

  const dayDir = (date: PlainDate | string): string => {
    const d = normalizeToPlainDate(date)
    return path.join(weekDir(d), `${d.monthPadded}-${d.dayPadded}`)
  }

  const dayFile = (date: PlainDate | string): string => {
    return path.join(dayDir(date), FILE_DAY)
  }

  const parseDateFromDayPath = (filePath: string): PlainDate => {
    const parts = filePath.split(path.sep)
    const timeIndex = parts.indexOf('time')
    if (timeIndex === -1) {
      throw new Error(`Invalid day file path: missing 'time' directory in ${filePath}`)
    }

    // After 'time': YYYY/W##/MM-DD (week dir possibly month-labeled)
    const yearStr = parts[timeIndex + 1]
    const weekStr = parts[timeIndex + 2]
    const dayStr = parts[timeIndex + 3]
    if (!yearStr || !weekStr || !dayStr) {
      throw new Error(`Invalid day file path: missing date components in ${filePath}`)
    }

    const year = parseInt(yearStr, 10)
    const dayMatch = dayStr.match(DAY_DIR)
    if (isNaN(year) || !WEEK_DIR.test(weekStr) || !dayMatch) {
      throw new Error(`Invalid date components in path ${filePath}: year=${yearStr}, week=${weekStr}, dayDir=${dayStr}`)
    }

    // The MM-DD day dir carries its own month - cross-month safe
    return new PlainDate(year, parseInt(dayMatch[1], 10), parseInt(dayMatch[2], 10))
  }

  const parseTimePath = (filePath: string): TimePathInfo | null => {
    const parts = filePath.split(path.sep)
    const timeIndex = parts.indexOf('time')
    if (timeIndex === -1) return null

    const rest = parts.slice(timeIndex + 1)
    // 'time' itself or a bare year dir - no document here.
    if (rest.length < 2) return null

    const [yearStr, second, third] = rest
    if (!YEAR_DIR.test(yearStr)) return null
    const year = parseInt(yearStr, 10)

    // PlainDate and Week validate their components - a well-shaped path
    // naming an impossible date or week classifies as null, not a crash.
    try {
      // time/YYYY/<file> - a year-level document
      if (rest.length === 2) {
        if (WEEK_DIR.test(second)) return null // bare week dir path
        return { kind: 'year', start: new PlainDate(year, 1, 1), end: new PlainDate(year, 12, 31) }
      }

      const week = second.match(WEEK_DIR)
      if (!week) return null

      // time/YYYY/W##/<file> - a week-level document. The span clips to the
      // week's own year: W00 starts Jan 1, W53 ends Dec 31.
      if (rest.length === 3) {
        if (DAY_DIR.test(third)) return null // bare day dir path
        const w = Week.from(year, parseInt(week[2], 10))
        return { kind: 'week', start: w.startInYear, end: w.endInYear }
      }

      // time/YYYY/W##/MM-DD/** - a day document. The day dir carries its
      // own month, so cross-month days are self-describing.
      const day = third.match(DAY_DIR)
      if (!day) return null
      const date = new PlainDate(year, parseInt(day[1], 10), parseInt(day[2], 10))
      return { kind: 'day', date, start: date, end: date }
    } catch {
      return null
    }
  }

  return { pattern, weekDir, dayDir, dayFile, parseDateFromDayPath, parseTimePath }
}

/** Bare week dirs. */
export const v2 = makeV2('YYYY/W##/MM-DD', false)

/** Month-labeled week dirs - same tree, scannable year listings. */
export const v2Months = makeV2('YYYY/MM-W##/MM-DD', true)
