import type { Day } from '../types.d.ts'
import subDays from './subDays.ts'

export default function previousDay(date: Date, day: number | Day): Date {
  let delta = date.getDay() - day
  if (delta <= 0) delta += 7

  return subDays(date, delta)
}
