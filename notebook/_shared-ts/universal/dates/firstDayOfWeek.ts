import { isMonday, previousMonday } from './dateFns/mod.ts'

// TODO: given firstDayOfTheWeek and lastDayOfTheWeek
// handles year crossings specific to the Notebook
// consider placing these functions elsewhere
// e.g. like in nbfs

// typically Monday unless the week crosses the new year
export default function firstDayOfWeek(date: Date): Date {
  const d = structuredClone(date)
  if (isMonday(d)) return d

  const prevMonday = previousMonday(d)

  // ensure we haven't crossed into a new year
  if (prevMonday.getFullYear() === d.getFullYear()) return prevMonday

  // it's a new year, return Jan 1st
  return new Date(d.getFullYear(), 0, 1)
}
