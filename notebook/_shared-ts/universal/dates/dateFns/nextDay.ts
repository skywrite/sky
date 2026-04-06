import type { Day } from '../types.d.ts'
import addDays from './addDays.ts'

export default function nextDay(date: Date, day: Day | number): Date {
  let delta = day - date.getDay()
  if (delta <= 0) delta += 7

  return addDays(date, delta)
}
