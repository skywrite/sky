import * as path from 'node:path'
import { firstDayOfWeek } from '#universal/dates/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import normalizeToPlainDate from './normalizeToPlainDate.ts'
import weekDir from './weekDir.ts'

/**
 * Get the day directory path for a given date.
 *
 * @param date - PlainDate instance or YMD string (e.g., "2025-03-15")
 * @returns Directory path like "2025/03/10-16/15" or "2025/03/10-16/x01" for cross-month
 */
export default function dayDir(date: PlainDate | string = new PlainDate()): string {
  const plainDate = normalizeToPlainDate(date)

  const dateObj = plainDate.toDate()
  const firstDay = firstDayOfWeek(dateObj)
  let dayStr = plainDate.dayPadded
  // prepend 'x' if the week spills into the next month
  dayStr = dateObj.getMonth() !== firstDay.getMonth() ? 'x' + dayStr : dayStr

  const wd = weekDir(plainDate)
  return path.join(wd, dayStr)
}
