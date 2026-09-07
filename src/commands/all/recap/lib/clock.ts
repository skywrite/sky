import { type Instant, type PlainDate, PlainDateTime } from '#universal/dates/nbdt/mod.ts'

/** Local wall-clock parts, using the zone's offset at this exact instant. */
export function wallClockParts(instant: Instant, timezone: string): { ymd: string; hour: number; minute: number } {
  const wall = instant.toZonedDateTimeISO(timezone)
  return { ymd: wall.toPlainDate().toString(), hour: wall.hour, minute: wall.minute }
}

/**
 * Wall-clock label for an instant, in the notebook day's extended-hours form.
 *
 * An event after midnight renders as 24:00+ under the day it extends (01:44
 * the next calendar date → "25:44") — never normalized to the next day,
 * matching how the notebook files late-night work.
 */
export function dayClock(instant: Instant, day: PlainDate, timezone: string): string {
  const wall = wallClockParts(instant, timezone)
  const dayHours = new PlainDateTime(day.ymd).until(new PlainDateTime(wall.ymd)).total('hours')
  const hours = wall.hour + dayHours
  return `${String(hours).padStart(2, '0')}:${String(wall.minute).padStart(2, '0')}`
}

/** Filename time prefix for a clock label: "09:12" → "09-12". */
export function clockPrefix(clock: string): string {
  return clock.replace(':', '-')
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Short human date for recap headings, e.g. "Feb 8". */
export function dayLabel(day: PlainDate): string {
  const [, m, d] = day.ymd.split('-').map(Number)
  return `${MONTHS[m - 1]} ${d}`
}
