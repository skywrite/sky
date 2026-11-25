import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { localDateOf } from './clock.ts'

/** Which day an instant counts for, as `YYYY-MM-DD`. */
export type DayOf = (epochMs: number) => string

/**
 * Notebook days: a day runs from the moment it was started until the next one is started.
 * A reply at half past midnight still belongs to the day that is open, and an early-morning reply sent before
 * the new day was started belongs to the day before.
 *
 * `startOf` answers when a calendar date's day was started, or null when it never was.
 */
export function createDayResolver(options: { timezone: string; startOf: (date: string) => number | null }): DayOf {
  const starts = new Map<string, number | null>()
  const startOf = (date: string): number | null => {
    if (!starts.has(date)) starts.set(date, options.startOf(date))
    return starts.get(date) ?? null
  }
  return (epochMs) => {
    const calendar = localDateOf(epochMs, options.timezone)
    let date = calendar
    // Two weeks back is further than any reply still worth counting.
    for (let back = 0; back < 14; back++) {
      const start = startOf(date)
      if (start !== null && start <= epochMs) return date
      date = new PlainDate(date).addDays(-1).ymd
    }
    return calendar
  }
}

/** Calendar days in a zone, for a host with no notebook days to follow. */
export function calendarDayOf(timezone: string): DayOf {
  return (epochMs) => localDateOf(epochMs, timezone)
}
