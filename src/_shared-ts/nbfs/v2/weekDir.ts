import * as path from 'node:path'
import { PlainDate, Week } from '#universal/dates/nbdt/mod.ts'
import normalizeToPlainDate from '../normalizeToPlainDate.ts'
import nbfsWeekMonth from './nbfsWeekMonth.ts'

/**
 * Get the v2 week directory path for a date.
 *
 * @param date - PlainDate instance or YMD string
 * @returns Path like "2026/02/W07"
 */
export default function weekDir(date: PlainDate | string): string {
  const d = normalizeToPlainDate(date)
  const week = Week.of(d).number
  const weekStr = String(week).padStart(2, '0')
  const monthStr = String(nbfsWeekMonth(d)).padStart(2, '0')
  return path.join(d.yearPadded, monthStr, `W${weekStr}`)
}
