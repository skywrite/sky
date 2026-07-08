import { DIR_TIME } from '#config'
import { PlainDateTime, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import currentTimezoneIANA from '#universal/dates/timezones/currentTimezoneIANA.ts'
import dayTimezone from './dayTimezone.ts'
import fetchNow from './fetchNow.ts'

export interface ConvertToNotebookTimezoneOptions {
  timeDir?: string
  /**
   * IANA zone the input wall-clock is expressed in. Date inputs render
   * through the process timezone, so only override this when it matches
   * how `when` was produced.
   */
  systemTimezone?: string
}

/**
 * Convert a timestamp to wall-clock time in the notebook day's timezone.
 *
 * Accepts a wall-clock string in the system timezone (e.g. "2026-06-15 02:00")
 * or a Date instant. The day whose `tz:` applies is the day the timestamp
 * falls on in the system timezone. Day-crossing conversions keep the
 * notebook's extended/negative-hours form (e.g. 25:00) instead of
 * normalizing to the next calendar date.
 *
 * Liberal in what it accepts, warning instead of throwing when input is off:
 * strings the notebook parser rejects get a second chance through native
 * Date parsing (ISO with zone, RFC 2822 headers); invalid Dates, empty or
 * unparseable strings, and non-string/non-Date values fall back to the
 * current notebook time; a failed timezone conversion (e.g. a bad `tz:` in
 * a day file) keeps the system wall clock.
 */
export default async function convertToNotebookTimezone(
  when: string | Date,
  options: ConvertToNotebookTimezoneOptions = {},
): Promise<PlainDateTime> {
  const { timeDir = DIR_TIME, systemTimezone = currentTimezoneIANA() } = options

  const inSystemTz = toSystemZoned(when, systemTimezone)
  if (typeof inSystemTz === 'string') {
    warn(`${inSystemTz}; falling back to the current notebook time`)
    return (await fetchNow({ timeDir })).plainDateTime
  }

  try {
    const dayTz = await dayTimezone(inSystemTz.date, timeDir)
    if (dayTz === systemTimezone) return inSystemTz.plainDateTime
    return inSystemTz.inTimeZone(dayTz).plainDateTime
  } catch (err) {
    warn(`converting "${inSystemTz.plainDateTime}" failed (${(err as Error).message}); keeping the system wall clock`)
    return inSystemTz.plainDateTime
  }
}

/** Parse the input into the system timezone, or return a warning reason. */
function toSystemZoned(when: string | Date, systemTimezone: string): ZonedDateTime | string {
  if (when instanceof Date) {
    if (Number.isNaN(when.getTime())) return 'received an invalid Date'
    return new ZonedDateTime(when, systemTimezone)
  }

  if (typeof when !== 'string') return `received unsupported input of type ${typeof when}`
  if (!when.trim()) return 'received an empty string'

  try {
    return new ZonedDateTime(when, systemTimezone)
  } catch {
    // Second chance: formats the notebook parser rejects but native Date
    // understands (ISO with zone designator, RFC 2822) parse as an instant
    const instant = new Date(when)
    if (Number.isNaN(instant.getTime())) return `could not parse "${when}"`
    return new ZonedDateTime(instant, systemTimezone)
  }
}

function warn(message: string): void {
  console.warn(`convertToNotebookTimezone(): ${message}.`)
}
