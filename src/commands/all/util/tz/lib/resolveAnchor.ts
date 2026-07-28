import PlainDateTime from '#universal/dates/nbdt/PlainDateTime/mod.ts'
import ZonedDateTime from '#universal/dates/nbdt/ZonedDateTime/mod.ts'

/**
 * The classified query, as the model returns it.
 *
 * `kind` separates the two shapes a timezone query takes:
 *   - `now` / `relative` are *instant* queries. The user supplied no wall clock, so any
 *     timezone they named is a display target only.
 *   - `wallClock` is a *conversion*. The user supplied a time, and it lives in
 *     `sourceTimezone`.
 *
 * Fields outside the active `kind` are ignored.
 */
export interface ParsedQuery {
  kind: 'now' | 'relative' | 'wallClock'
  /** kind=relative: minutes from now, negative for the past. */
  relativeMinutes: number
  /** kind=wallClock: hour in 24-hour format. */
  hours: number
  /** kind=wallClock: minutes past the hour. */
  minutes: number
  /** kind=wallClock: days from today. */
  dateOffset: number
  /** kind=wallClock: IANA zone the supplied time lives in; empty means the user's own. */
  sourceTimezone: string
}

/**
 * Resolve a classified query to the instant to convert from.
 *
 * The arithmetic lives here rather than in the model: the model only classifies, so a
 * "now" query stays accurate however long the round trip takes.
 */
export function resolveAnchor(parsed: ParsedQuery, systemNow: ZonedDateTime, systemTimezone: string): ZonedDateTime {
  switch (parsed.kind) {
    case 'now':
      return systemNow

    case 'relative':
      // addHours takes fractional hours; normalize folds the over/underflow into the date.
      return systemNow.addHours(parsed.relativeMinutes / 60).normalize()

    case 'wallClock': {
      // Day arithmetic goes through PlainDate so it stays in local components — going via
      // Date#toISOString would read back a UTC date and slip a day east of UTC.
      const date = systemNow.plainDateTime.plainDate.addDays(parsed.dateOffset)
      const time = `${String(parsed.hours).padStart(2, '0')}:${String(parsed.minutes).padStart(2, '0')}`
      return new ZonedDateTime(new PlainDateTime(time, date), parsed.sourceTimezone || systemTimezone)
    }
  }
}
