import getTimezoneOffsetInMilliseconds from './getTimezoneOffsetInMilliseconds.ts'
import startOfDay from './startOfDay.ts'

const millisecondsInDay = 86400000

export default function differenceInCalendarDays(dateLeft: Date, dateRight: Date): number {
  const startOfDayLeft = startOfDay(dateLeft)
  const startOfDayRight = startOfDay(dateRight)

  const timestampLeft = startOfDayLeft.getTime() - getTimezoneOffsetInMilliseconds(startOfDayLeft)
  const timestampRight = startOfDayRight.getTime() - getTimezoneOffsetInMilliseconds(startOfDayRight)

  // Round the number of days to the nearest integer
  // because the number of milliseconds in a day is not constant
  // (e.g. it's different in the day of the daylight saving time clock shift)
  return Math.round((timestampLeft - timestampRight) / millisecondsInDay)
}
