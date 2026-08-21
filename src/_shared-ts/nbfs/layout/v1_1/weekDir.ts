import * as path from 'node:path'
import daysOfWeek from '#universal/dates/daysOfWeek.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import normalizeToPlainDate from '../../normalizeToPlainDate.ts'

/**
 * Get the week directory path for a given date.
 *
 * @param date - PlainDate instance or YMD string (e.g., "2025-03-15")
 * @returns Directory path like "2025/03/10-16"
 */
export default function weekDir(date: PlainDate | string = new PlainDate()): string {
  const plainDate = normalizeToPlainDate(date)
  const dateObj = plainDate.toDate()
  const days = daysOfWeek(dateObj)
  const firstDay = days.at(0)
  const lastDay = days.at(-1)

  if (!firstDay || !lastDay) throw new Error(`${firstDay} or ${lastDay} is undefined.`)

  const firstDayNumSt = new PlainDate(firstDay).dayPadded
  const lastDayNumSt = new PlainDate(lastDay).dayPadded

  const yearStr = plainDate.yearPadded
  const monthStr = new PlainDate(firstDay).monthPadded

  const weekDirName = firstDayNumSt + '-' + lastDayNumSt

  return path.join(yearStr, monthStr, weekDirName)
}
