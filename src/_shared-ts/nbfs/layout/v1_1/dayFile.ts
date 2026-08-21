import * as path from 'node:path'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import normalizeToPlainDate from '../../normalizeToPlainDate.ts'
import { FILE_DAY } from '../types.ts'
import dayDir from './dayDir.ts'

export { FILE_DAY } from '../types.ts'

/**
 * Get the day file path for a given date.
 *
 * @param date - PlainDate instance or YMD string (e.g., "2025-03-15")
 * @returns File path like "2025/03/10-16/03-15/day.md"
 */
export default function dayFile(date: PlainDate | string = new PlainDate()): string {
  const plainDate = normalizeToPlainDate(date)
  const dir = dayDir(plainDate)
  return path.join(dir, FILE_DAY)
}
