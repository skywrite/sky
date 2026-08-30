/**
 * The moment a tracking answer is stamped with.
 *
 * A hand-kept row is keyed to the calendar day you are awake in, with the
 * wall-clock time, hour unpadded (`6:12`, `18:00`). This helper reproduces
 * that: the system clock, seen from the notebook's timezone, normalized
 * across midnight.
 *
 * Deliberately NOT fetchNow. fetchNow keys "now" to the last *started* day,
 * so at 6:12 on a morning before day:start it reads "yesterday 30:12" — and
 * a weigh-in taken after waking would land on yesterday's row.
 * See ../docs/2026-08-30-calendar-day-not-open-day.md.
 */

import { dayTimezone } from '#shared/nbfs/mod.ts'
import { PlainDate, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'

export interface CaptureMoment {
  /** Calendar day the wall clock is in, in the notebook's timezone. */
  date: PlainDate
  /** Wall-clock time in that zone, hour unpadded (`6:12`, `18:00`). */
  time: string
}

/**
 * Pure core: `now` (any zone) as seen from `timezone`. Crossing midnight
 * rolls the date — no extended hours here, a capture is stamped with the
 * day it happens on.
 */
export function captureMoment(now: ZonedDateTime, timezone: string): CaptureMoment {
  const local = now.inTimeZone(timezone).normalize().plainDateTime
  return { date: local.plainDate, time: local.time.replace(/^0(?=\d:)/, '') }
}

/** The current moment for a capture: system clock in the notebook's timezone. */
export async function currentMoment(timeDir: string): Promise<CaptureMoment> {
  const system = new ZonedDateTime()
  const timezone = await dayTimezone(system.plainDateTime.plainDate, timeDir)
  return captureMoment(system, timezone)
}
