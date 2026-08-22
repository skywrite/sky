import * as path from 'node:path'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'

/**
 * Parses a PlainDate from a day file path.
 *
 * Day files are structured as: time/YYYY/MM/DD-DD/MM-DD/day.md
 * where the day dir carries its own month, so cross-month spillover
 * days are self-describing.
 *
 * @param filePath - The full path to a day file
 * @returns PlainDate representing the date
 * @throws Error if the path is not a valid day file path
 *
 * @example
 * parseDateFromDayPath('/path/to/Notebook/time/2022/03/21-27/03-21/day.md')
 * // Returns: PlainDate for 2022-03-21
 *
 * @example
 * parseDateFromDayPath('/path/to/Notebook/time/2022/03/28-03/04-02/day.md')
 * // Returns: PlainDate for 2022-04-02 (cross-month day, month from the day dir)
 */
export default function parseDateFromDayPath(filePath: string): PlainDate {
  const parts = filePath.split(path.sep)

  // Find the 'time' directory index
  const timeIndex = parts.indexOf('time')
  if (timeIndex === -1) {
    throw new Error(`Invalid day file path: missing 'time' directory in ${filePath}`)
  }

  // After 'time', we have: YYYY/MM/DD-DD/MM-DD
  const offset = timeIndex + 1

  const yearStr = parts[offset]
  const dayStr = parts[offset + 3] // Skip month and week range (DD-DD)

  if (!yearStr || !dayStr) {
    throw new Error(`Invalid day file path: missing date components in ${filePath}`)
  }

  const year = parseInt(yearStr, 10)
  const dayDirMatch = dayStr.match(/^(\d{2})-(\d{2})$/)

  if (isNaN(year) || !dayDirMatch) {
    throw new Error(`Invalid date components in path ${filePath}: year=${yearStr}, dayDir=${dayStr}`)
  }

  const month = parseInt(dayDirMatch[1], 10)
  const day = parseInt(dayDirMatch[2], 10)

  // The MM-DD day dir carries its own month — cross-month safe
  return new PlainDate(adjustV1_1BoundaryYear(year, month, day, parts[offset + 1], parts[offset + 2]), month, day)
}

/**
 * v1.1's one lie, arbitrated by the week range. week:new created a whole
 * week under its Monday's year, so a January day of year Y+1 can sit at
 * Y/12/DD-DD/01-DD — the same shape a correctly-filed boundary day has
 * under its own year (Y/12/DD-DD/01-DD with the week starting in December
 * of Y-1). The week range decides: bump the year only when the bumped
 * date's true Monday–Sunday week starts in the December the path names and
 * carries exactly the range in the directory name.
 */
export function adjustV1_1BoundaryYear(
  year: number,
  month: number,
  day: number,
  monthSeg: string | undefined,
  weekSeg: string | undefined,
): number {
  if (monthSeg !== '12' || month !== 1 || !weekSeg) return year

  const bumped = new PlainDate(year + 1, month, day)
  const weekStart = bumped.addDays(-(bumped.dayOfWeek - 1))
  if (weekStart.month !== 12 || weekStart.year !== year) return year

  const weekEnd = weekStart.addDays(6)
  const range = `${weekStart.dayPadded}-${weekEnd.dayPadded}`
  return range === weekSeg ? year + 1 : year
}
