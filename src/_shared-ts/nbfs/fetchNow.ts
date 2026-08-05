// TODO: refactor shared logic between fetchNow and fetchNowSync

import { DIR_TIME } from '#config'
import DayDocument from '#shared/models/Day/mod.ts'
import { PlainDateTime, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { type FetchNowOptions } from './fetchNowSync.ts'
import readDay from './readDay.ts'

export default async function fetchNow(options: FetchNowOptions = {}): Promise<ZonedDateTime> {
  const { timeDir = DIR_TIME, now = new ZonedDateTime() } = options
  const nowPlainDate = now.plainDateTime.plainDate

  let dayModel: DayDocument | undefined
  let hasStarted = false

  try {
    dayModel = await readDay(nowPlainDate, timeDir)
    hasStarted = Boolean(dayModel.started)
  } catch (_e) {
    // intentionally empty
  }

  let dayCounter = 0
  const maxDaysToCheck = 365 // Safety limit to prevent infinite loop
  while (!hasStarted && dayCounter < maxDaysToCheck) {
    dayCounter += 1
    const checkDate = nowPlainDate.addDays(-dayCounter)
    try {
      dayModel = await readDay(checkDate, timeDir)
      hasStarted = Boolean(dayModel.started)
    } catch (_e) {
      // File doesn't exist, continue to previous day
      continue
    }
  }

  if (!dayModel) throw new Error('Unable to compute the current date / time.')

  // Convert now to the day's timezone (handles DST correctly at the actual instant)
  const nowInDayTz = now.inTimeZone(dayModel.timezone)
  const [nowHours, nowMinutes] = nowInDayTz.time.split(':').map(Number)
  const hours = dayCounter * 24 + nowHours
  const minutes = nowMinutes

  const thisPlainDt = new PlainDateTime(`${hours}:${minutes}`, dayModel.YMD)
  return new ZonedDateTime(thisPlainDt, dayModel.timezone)
}
