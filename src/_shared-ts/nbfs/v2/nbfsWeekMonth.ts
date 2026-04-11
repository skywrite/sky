import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import normalizeToPlainDate from '../normalizeToPlainDate.ts'
import nbfsWeekNumber from './nbfsWeekNumber.ts'

/**
 * Get the month directory number for a date's week.
 *
 * Uses the "month of Thursday" rule: a week's month is determined by
 * which month its Thursday falls in. This is consistent with ISO 8601,
 * which uses Thursday to determine the week-year.
 *
 * Special cases:
 * - W00 dates → 1 (January, overflow bucket always under 01/)
 * - W53 dates → 12 (December, overflow bucket always under 12/)
 *
 * @param date - PlainDate instance or YMD string
 * @returns Month number (1-12)
 */
export default function nbfsWeekMonth(date: PlainDate | string): number {
  const d = normalizeToPlainDate(date)
  const week = nbfsWeekNumber(d)

  // Overflow buckets have fixed months
  if (week === 0) return 1
  if (week === 53) return 12

  // Find Thursday of this date's week: Thursday = dayOfWeek 4
  const thursday = d.addDays(4 - d.dayOfWeek)
  return thursday.month
}
