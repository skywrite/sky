import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import configured from './layout/configured.ts'

/**
 * Day directory for a date in the configured layout (nbfs.layout).
 *
 * @param date - PlainDate instance or YMD string (e.g., "2025-03-15")
 * @returns Directory path relative to time/, e.g. "2025/W11/03-15"
 */
export default function dayDir(date: PlainDate | string = new PlainDate()): string {
  return configured.dayDir(date)
}
