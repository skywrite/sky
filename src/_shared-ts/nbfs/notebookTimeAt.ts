import { DIR_TIME } from '#config'
import type DayDocument from '#shared/models/Day/mod.ts'
import { PlainDate, PlainDateTime, type ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import currentTimezoneIANA from '#universal/dates/timezones/currentTimezoneIANA.ts'
import convertToNotebookTimezone, {
  type ConvertToNotebookTimezoneOptions,
  toSystemZoned,
} from './convertToNotebookTimezone.ts'
import readDay from './readDay.ts'

// How far back to look for the day that was open. A moment deeper into a
// stretch with no started day files under its own calendar day instead.
const LOOKBACK_DAYS = 7

export interface NotebookTimeAtOptions extends ConvertToNotebookTimezoneOptions {
  /**
   * The day file for a date, or undefined when there is none. A caller
   * stamping many moments hands in a reader that remembers what it read;
   * the default reads the file each time.
   */
  dayAt?: (date: PlainDate) => Promise<DayDocument | undefined>
}

async function readDayOrNone(date: PlainDate, timeDir: string): Promise<DayDocument | undefined> {
  try {
    return await readDay(date, timeDir)
  } catch {
    // No day file there, or one that cannot be read
    return undefined
  }
}

/**
 * The notebook time at a moment: the day that was open then — the last one
 * started at or before it — and the time on that day in its zone, with hours
 * past 24 once the day ran past midnight. A Slack message sent at 00:30 while
 * Monday is still open is Monday 24:30, where a capture made at that moment
 * would have filed: fetchNow attributes the present the same way.
 *
 * Takes what convertToNotebookTimezone takes, and falls back to it (the
 * moment's calendar day) for input it cannot parse or when no day was started
 * in the week before.
 */
export default async function notebookTimeAt(
  when: string | Date,
  options: NotebookTimeAtOptions = {},
): Promise<PlainDateTime> {
  const { timeDir = DIR_TIME, systemTimezone = currentTimezoneIANA() } = options
  const dayAt = options.dayAt ?? ((date: PlainDate) => readDayOrNone(date, timeDir))
  const moment = toSystemZoned(when, systemTimezone)
  if (typeof moment === 'string') return convertToNotebookTimezone(when, { timeDir, systemTimezone })
  const open = await openDayAt(moment, dayAt)
  if (!open) return convertToNotebookTimezone(when, { timeDir, systemTimezone })

  const local = moment.inTimeZone(open.timezone)
  const [hours, minutes] = local.time.split(':').map(Number)
  const days = daysFrom(new PlainDate(open.YMD), local.plainDateTime.plainDate)
  return new PlainDateTime(`${days * 24 + hours}:${String(minutes).padStart(2, '0')}`, open.YMD)
}

/** The last day started at or before the moment, within the lookback. */
async function openDayAt(
  moment: ZonedDateTime,
  dayAt: (date: PlainDate) => Promise<DayDocument | undefined>,
): Promise<DayDocument | undefined> {
  // From the day after: a day kept in a zone ahead of the system's can start
  // before the system's midnight.
  const from = moment.plainDateTime.plainDate.addDays(1)
  for (let back = 0; back <= LOOKBACK_DAYS + 1; back++) {
    const day = await dayAt(from.addDays(-back))
    const started = day?.started
    if (started && started.epochMilliseconds <= moment.epochMilliseconds) return day
  }
  return undefined
}

/** Whole days from one date to another, negative when `to` comes first. */
function daysFrom(from: PlainDate, to: PlainDate): number {
  let days = 0
  for (let date = from; PlainDate.compare(date, to) < 0; date = date.addDays(1)) days++
  for (let date = from; PlainDate.compare(date, to) > 0; date = date.addDays(-1)) days--
  return days
}
