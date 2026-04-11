import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import normalizeToPlainDate from '../normalizeToPlainDate.ts'

/**
 * Get the NBFS week number for a date.
 *
 * Uses ISO week number with two boundary adjustments:
 * - W00: January days that fall in the previous year's final ISO week
 * - W53: December days that fall in the next year's ISO week 1
 *
 * @param date - PlainDate instance or YMD string
 * @returns Week number (0-53)
 */
export default function nbfsWeekNumber(date: PlainDate | string): number {
  const d = normalizeToPlainDate(date)
  const isoWeek = d.weekOfYear

  // January days in previous year's last ISO week → W00
  if (d.month === 1 && isoWeek >= 52) return 0

  // December days in next year's ISO week 1 → W53
  if (d.month === 12 && isoWeek === 1) return 53

  return isoWeek
}
