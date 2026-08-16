import type { PlainDate } from '#universal/dates/nbdt/mod.ts'
import timezoneToUTCOffsetInHours from '#universal/dates/timezones/timezoneToUTCOffsetInHours.ts'

/** Calendar days between two YMD strings — pure calendar math, no timezones. */
function daysBetween(fromYmd: string, toYmd: string): number {
  const [fy, fm, fd] = fromYmd.split('-').map(Number)
  const [ty, tm, td] = toYmd.split('-').map(Number)
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000)
}

/**
 * Wall-clock label for an instant, in the notebook day's extended-hours form.
 *
 * An event after midnight renders as 24:00+ under the day it extends (01:44
 * the next calendar date → "25:44") — never normalized to the next day,
 * matching how the notebook files late-night work.
 */
export function dayClock(instant: Date, day: PlainDate, timezone: string): string {
  // Shift the instant by the zone's offset and read UTC fields — explicit
  // offset math instead of the process timezone, which is known to wobble.
  const offsetHours = timezoneToUTCOffsetInHours(timezone, instant)
  const wall = new Date(instant.getTime() + offsetHours * 3_600_000)
  const y = wall.getUTCFullYear()
  const m = String(wall.getUTCMonth() + 1).padStart(2, '0')
  const d = String(wall.getUTCDate()).padStart(2, '0')
  const offsetDays = daysBetween(day.ymd, `${y}-${m}-${d}`)
  const hours = wall.getUTCHours() + offsetDays * 24
  return `${String(hours).padStart(2, '0')}:${String(wall.getUTCMinutes()).padStart(2, '0')}`
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
