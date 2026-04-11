import * as path from 'node:path'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import daysOfWeek from '#universal/dates/daysOfWeek.ts'
import normalizeToPlainDate from './normalizeToPlainDate.ts'

/**
 * Get the week directory path for a given date.
 *
 * @param date - PlainDate instance or YMD string (e.g., "2025-03-15")
 * @returns Directory path like "2025/03/10-16" or "_pre-2020/2019/04/01-07"
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

  // didn't start the notebook until Nov 2020; so any
  // year before was added retroactively
  const dirs = [yearStr, monthStr, weekDirName]
  if (plainDate.year < 2020) dirs.unshift('_pre-2020')

  return path.join(...dirs)
}
