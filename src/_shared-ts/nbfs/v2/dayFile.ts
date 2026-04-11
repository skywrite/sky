import * as path from 'node:path'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import dayDir from './dayDir.ts'

/**
 * Get the v2 day file path for a date.
 *
 * @param date - PlainDate instance or YMD string
 * @returns Path like "2026/W07/02.15/day.md"
 */
export default function dayFile(date: PlainDate | string): string {
  return path.join(dayDir(date), 'day.md')
}
