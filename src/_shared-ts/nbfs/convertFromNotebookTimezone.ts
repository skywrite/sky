import { Instant, type PlainDateTime, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import dayTimezone from './dayTimezone.ts'

export interface ConvertFromNotebookTimezoneOptions {
  timeDir?: string
}

/**
 * The instant a notebook time names: the inverse of convertToNotebookTimezone.
 *
 * A notebook time is the wall clock of the day it is written under, in that
 * day's `tz:`, extended hours included ("25:30" is half past one the next
 * morning). It is read back in that same zone. Read in the system timezone
 * instead, a time written on a day kept in another zone — while traveling —
 * lands hours away from the moment it was stamped from.
 */
export default async function convertFromNotebookTimezone(
  when: PlainDateTime,
  options: ConvertFromNotebookTimezoneOptions = {},
): Promise<Instant> {
  const zone = await dayTimezone(when.plainDate, options.timeDir)
  return Instant.fromEpochMilliseconds(new ZonedDateTime(when, zone).epochMilliseconds)
}
