import type { PlainDate } from '#universal/dates/nbdt/mod.ts'
import configured from './layout/configured.ts'

/**
 * Date of a day-file path in the configured layout (nbfs.layout).
 * Throws when the path doesn't speak that layout.
 */
export default function parseDateFromDayPath(filePath: string): PlainDate {
  return configured.parseDateFromDayPath(filePath)
}
