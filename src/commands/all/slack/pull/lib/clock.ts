import { formatSlackTimestamp } from '#commands/all/slack/lib/mod.ts'
import { DIR_TIME } from '#config'
import type DayDocument from '#shared/models/Day/mod.ts'
import { notebookTimeAt, readDay } from '#shared/nbfs/mod.ts'
import type { PlainDate } from '#universal/dates/nbdt/mod.ts'

/** The three clocks a cached message carries. */
export type ClockStamps = {
  /** The notebook's day and time: the day open at that moment, in its zone, hours past 24 once the day ran past midnight */
  notebook: string
  /** The system's wall clock at that moment */
  system: string
  /** The system's zone, IANA */
  zone: string
  /** The moment in UTC */
  utc: string
}

export type Clock = (ts: string) => Promise<ClockStamps>

/**
 * A clock for one pull. The notebook time follows the rule captures file
 * by (nbfs/notebookTimeAt): the last day started at or before the moment,
 * in that day's zone, hours past 24 once the day ran past midnight; with no
 * started day in reach, the calendar day. The day files it consults are
 * read once per clock.
 */
export function createClock(input: { timezone: string; timeDir?: string }): Clock {
  const timeDir = input.timeDir ?? DIR_TIME
  const days = new Map<string, Promise<DayDocument | undefined>>()
  const dayAt = (date: PlainDate): Promise<DayDocument | undefined> => {
    let day = days.get(date.ymd)
    if (!day) {
      day = readDay(date, timeDir).catch(() => undefined)
      days.set(date.ymd, day)
    }
    return day
  }
  return async (ts) => {
    const system = formatSlackTimestamp(ts, input.timezone)
    const notebook = (await notebookTimeAt(system, { timeDir, systemTimezone: input.timezone, dayAt })).toString()
    return { notebook, system, zone: input.timezone, utc: formatSlackTimestamp(ts, 'UTC') }
  }
}
