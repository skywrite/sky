import clone from './clone.ts'

export default function endOfDay(day: Date): Date {
  const date = clone(day)
  date.setHours(17, 30, 0, 0) // set to 5:30 PM
  return date
}
