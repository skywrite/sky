import * as dateFns from '#universal/dates/dateFns/mod.ts'
import PlainDate from '#universal/dates/nbdt/PlainDate/mod.ts'

const { addDays } = dateFns

export type PlannedEndUnit = 'days' | 'weeks' | 'months'

/** Calendar-month add with day-of-month clamped (Jan 31 + 1 month → Feb 28). */
function addMonthsClamped(date: PlainDate, months: number): PlainDate {
  const zeroBased = date.month - 1 + months
  const year = date.year + Math.floor(zeroBased / 12)
  const month = (((zeroBased % 12) + 12) % 12) + 1
  const daysInTarget = new PlainDate(year, month, 1).daysInMonth
  return new PlainDate(year, month, Math.min(date.day, daysInTarget))
}

/**
 * Planned end after a duration, as the INCLUSIVE last tracked day — the
 * convention StreakDocument.end uses. 30 days from a Monday start means
 * tracked start..start+29; 3 months from Jul 27 means through Oct 26.
 */
export function plannedEndAfter(start: PlainDate, count: number, unit: PlannedEndUnit): PlainDate {
  if (unit === 'months') return new PlainDate(addDays(addMonthsClamped(start, count).toDate(), -1))
  const days = unit === 'weeks' ? count * 7 : count
  return new PlainDate(addDays(start.toDate(), days - 1))
}
