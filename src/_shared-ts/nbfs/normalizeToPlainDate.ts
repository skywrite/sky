import { REGEX_YMD_EXACT } from '#universal/dates/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'

/**
 * Normalize a date input to PlainDate.
 *
 * @param date - PlainDate instance or YMD string (e.g., "2025-03-15")
 * @returns PlainDate instance
 * @throws Error if string is not in valid YMD format
 */
export default function normalizeToPlainDate(date: PlainDate | string): PlainDate {
  if (date instanceof PlainDate) {
    return date
  }

  if (!REGEX_YMD_EXACT.test(date)) {
    throw new Error(`Invalid date format: "${date}". Expected YMD format (e.g., "2025-03-15")`)
  }

  return new PlainDate(date)
}
