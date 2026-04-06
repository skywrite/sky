import * as path from 'node:path'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'

/**
 * Parses a PlainDate from a day file path.
 *
 * Day files are structured as: time/[_pre-2020/]YYYY/MM/DD-DD/DD/day.md
 * where the final DD may be prefixed with 'x' if it spills into the next month.
 *
 * @param filePath - The full path to a day file
 * @returns PlainDate representing the date
 * @throws Error if the path is not a valid day file path
 *
 * @example
 * parseDateFromDayPath('/path/to/Notebook/time/2022/03/21-27/21/day.md')
 * // Returns: PlainDate for 2022-03-21
 *
 * @example
 * parseDateFromDayPath('/path/to/Notebook/time/2022/03/28-03/x02/day.md')
 * // Returns: PlainDate for 2022-04-02 (x prefix means next month)
 *
 * @example
 * parseDateFromDayPath('/path/to/Notebook/time/_pre-2020/2019/04/01-07/05/day.md')
 * // Returns: PlainDate for 2019-04-05
 */
export default function parseDateFromDayPath(filePath: string): PlainDate {
  const parts = filePath.split(path.sep)

  // Find the 'time' directory index
  const timeIndex = parts.indexOf('time')
  if (timeIndex === -1) {
    throw new Error(`Invalid day file path: missing 'time' directory in ${filePath}`)
  }

  // After 'time', we have: [_pre-2020/]YYYY/MM/DD-DD/DD
  let offset = timeIndex + 1

  // Check for _pre-2020 prefix
  if (parts[offset] === '_pre-2020') {
    offset++
  }

  const yearStr = parts[offset]
  const monthStr = parts[offset + 1]
  const dayStr = parts[offset + 3] // Skip week range (DD-DD)

  if (!yearStr || !monthStr || !dayStr) {
    throw new Error(`Invalid day file path: missing date components in ${filePath}`)
  }

  let year = parseInt(yearStr, 10)
  let month = parseInt(monthStr, 10)
  let day: number

  // Handle 'x' prefix for next month spillover
  if (dayStr.startsWith('x')) {
    day = parseInt(dayStr.slice(1), 10)
    month++ // Day is in the next month

    // Handle year rollover
    if (month > 12) {
      month = 1
      year++
    }
  } else {
    day = parseInt(dayStr, 10)
  }

  if (isNaN(year) || isNaN(month) || isNaN(day)) {
    throw new Error(`Invalid date components in path ${filePath}: year=${year}, month=${month}, day=${day}`)
  }

  return new PlainDate(year, month, day)
}
