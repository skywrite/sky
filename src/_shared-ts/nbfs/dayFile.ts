import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import configured from './layout/configured.ts'

export { FILE_DAY } from './layout/types.ts'

/**
 * day.md path for a date in the configured layout (nbfs.layout).
 *
 * @param date - PlainDate instance or YMD string (e.g., "2025-03-15")
 * @returns File path relative to time/, e.g. "2025/03/10-16/03-15/day.md"
 */
export default function dayFile(date: PlainDate | string = new PlainDate()): string {
  return configured.dayFile(date)
}
