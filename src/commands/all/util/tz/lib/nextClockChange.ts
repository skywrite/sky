import { timezoneToUTCOffsetInHours } from '#universal/dates/timezones/mod.ts'

// No DST period in the tz database is shorter than a few weeks, so a 7-day stride cannot
// step over a transition without bracketing it.
const STRIDE_MS = 7 * 86400000

// Far enough ahead to catch every scheduled change. Zones with standing DST rules always
// transition within ~12 months, so nothing inside this window means the zone doesn't shift.
const DEFAULT_HORIZON_DAYS = 800

export interface ClockChange {
  /** The instant the offset changes. */
  at: Date
  /**
   * Hours the clock moves: positive springing forward, negative falling back. Fractional for
   * the zones that shift by less than an hour — Lord Howe Island moves 30 minutes.
   */
  deltaHours: number
}

/**
 * Find when a timezone's UTC offset next changes.
 *
 * This is "the next clock change" rather than "the next DST transition" — the tz database
 * exposes that an offset moves, not why. Ramadan shifts and one-off legal changes surface
 * here alongside ordinary DST, which is what a reader of the column wants either way.
 *
 * Returns null when the zone holds a single offset across the whole horizon.
 *
 * Offsets come from timezoneToUTCOffsetInHours, whose quarter-hour rounding is load-bearing:
 * Intl only resolves to the second, so comparing raw offsets would let the millisecond
 * component of each probe make every sample unequal and the search would chase noise.
 */
export function nextClockChange(
  timezone: string,
  from: Date,
  horizonDays: number = DEFAULT_HORIZON_DAYS,
): ClockChange | null {
  const offsetAt = (ms: number): number => timezoneToUTCOffsetInHours(timezone, new Date(ms))

  const base = offsetAt(from.getTime())
  const limit = from.getTime() + horizonDays * 86400000

  // Coarse scan for the interval that straddles the change.
  let lo = from.getTime()
  let hi: number | null = null
  for (let probe = lo + STRIDE_MS; probe <= limit; probe += STRIDE_MS) {
    if (offsetAt(probe) !== base) {
      hi = probe
      lo = probe - STRIDE_MS
      break
    }
  }
  if (hi === null) return null

  // Narrow to the exact instant. `low` always sits on the old offset, `high` on the new one.
  // Rebound here rather than reusing `hi`, whose nullable type would widen again once the
  // loop assigns to it.
  let low = lo
  let high = hi
  while (high - low > 1) {
    const mid = low + Math.floor((high - low) / 2)
    if (offsetAt(mid) === base) low = mid
    else high = mid
  }
  // Quarter-hour offsets are exact binary fractions, so this subtraction needs no rounding.
  return { at: new Date(high), deltaHours: offsetAt(high) - base }
}
