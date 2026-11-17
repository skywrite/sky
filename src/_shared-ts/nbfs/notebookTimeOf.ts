import { DIR_TIME } from '#config'
import { type Instant, PlainDate, PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import readDaySync from './readDaySync.ts'

/** How far back a moment's day is looked for. */
const MAX_DAYS = 365

/**
 * How the notebook writes a past moment: on the clock of the day that was
 * running then, in that day's time zone. A recording made on a trip reads in
 * the trip's time even when it is filed later from home; one made after
 * midnight, before the next day started, reads 25:10 on the day before. With
 * no started day to go by, the moment reads in `timezone`.
 */
export default function notebookTimeOf(instant: Instant, timezone: string, timeDir = DIR_TIME): PlainDateTime {
  // The running day started at or before the moment, so its date is on or
  // before the latest date the moment falls on anywhere in the world.
  const latest = new PlainDate(instant.toZonedDateTimeISO('+14:00').toPlainDate().toString())
  for (let back = 0; back <= MAX_DAYS; back++) {
    const date = latest.addDays(-back)
    const started = startedDay(date, timeDir)
    if (!started || started.at > instant.epochMilliseconds) continue
    const local = instant.toZonedDateTimeISO(started.timezone)
    const localDate = new PlainDate(local.toPlainDate().toString())
    let days = 0
    while (PlainDate.compare(date.addDays(days), localDate) < 0) days++
    return new PlainDateTime(`${days * 24 + local.hour}:${local.minute}`, date.toString())
  }
  return new PlainDateTime(
    instant.toZonedDateTimeISO(timezone).toPlainDateTime().toString({ smallestUnit: 'minute' }).replace('T', ' '),
  )
}

/** When the day started, as epoch milliseconds, and its time zone; nothing for a day never started or not there. */
function startedDay(date: PlainDate, timeDir: string): { at: number; timezone: string } | undefined {
  try {
    const day = readDaySync(date, timeDir)
    const started = day.started
    return started ? { at: started.epochMilliseconds, timezone: day.timezone } : undefined
  } catch {
    return undefined
  }
}
