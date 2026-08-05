import firstDayOfWeek from '#universal/dates/firstDayOfWeek.ts'
import lastDayOfWeek from '#universal/dates/lastDayOfWeek.ts'
import addDays from './dateFns/addDays.ts'
import isSameDay from './dateFns/isSameDay.ts'

// TODO: given firstDayOfTheWeek and lastDayOfTheWeek
// handles year crossings specific to the Notebook
// consider placing these functions elsewhere
// e.g. like in nbfs

export default function daysOfWeek(date: Date): Array<Date> {
  const firstDay = firstDayOfWeek(date)
  const lastDay = lastDayOfWeek(date)
  const days = [firstDay]

  let nextDay = firstDay
  while (!isSameDay(nextDay, lastDay)) {
    nextDay = addDays(nextDay, 1)
    days.push(nextDay)
  }

  return days
}
