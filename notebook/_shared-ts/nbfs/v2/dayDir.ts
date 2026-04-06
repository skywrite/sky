import * as path from 'node:path'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import normalizeToPlainDate from '../normalizeToPlainDate.ts'
import weekDir from './weekDir.ts'

/**
 * Get the v2 day directory path for a date.
 *
 * @param date - PlainDate instance or YMD string
 * @returns Path like "2026/W07/02.15"
 */
export default function dayDir(date: PlainDate | string): string {
  const d = normalizeToPlainDate(date)
  return path.join(weekDir(d), `${d.monthPadded}.${d.dayPadded}`)
}
