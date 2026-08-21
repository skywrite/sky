import * as path from 'node:path'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import normalizeToPlainDate from '../../normalizeToPlainDate.ts'
import weekDir from './weekDir.ts'

/**
 * Get the day directory path for a given date.
 *
 * Day dirs are named MM-DD (v1.1) so cross-month spillover days carry
 * their own month and always sort chronologically within their week —
 * no special marker needed.
 *
 * @param date - PlainDate instance or YMD string (e.g., "2025-03-15")
 * @returns Directory path like "2025/03/10-16/03-15", or "2022/03/28-03/04-02" for a cross-month day
 */
export default function dayDir(date: PlainDate | string = new PlainDate()): string {
  const plainDate = normalizeToPlainDate(date)
  const dayStr = plainDate.monthPadded + '-' + plainDate.dayPadded
  return path.join(weekDir(plainDate), dayStr)
}
