import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import configured from './layout/configured.ts'

/**
 * Week directory for a date in the configured layout (nbfs.layout).
 *
 * @param date - PlainDate instance or YMD string (e.g., "2025-03-15")
 * @returns Directory path relative to time/, e.g. "2025/03/10-16"
 */
export default function weekDir(date: PlainDate | string = new PlainDate()): string {
  return configured.weekDir(date)
}
