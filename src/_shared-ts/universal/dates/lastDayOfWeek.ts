import { isSunday, nextSunday } from './dateFns/mod.ts'

// TODO: given firstDayOfTheWeek and lastDayOfTheWeek
// handles year crossings specific to the Notebook
// consider placing these functions elsewhere
// e.g. like in nbfs

// typically Sunday unless the week crosses the new year
export default function lastDayOfWeek(date: Date): Date {
  const d = structuredClone(date)
  if (isSunday(d)) return d

  const nextSun = nextSunday(d)

  // ensure we haven't crossed into a new year
  if (nextSun.getFullYear() === d.getFullYear()) return nextSun

  // it's a new year, return Dec 31
  return new Date(d.getFullYear(), 11, 31)
}
