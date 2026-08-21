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

  // The MM-DD day dir carries its own month — cross-month safe
  return new PlainDate(year, parseInt(dayDirMatch[1], 10), parseInt(dayDirMatch[2], 10))
}
