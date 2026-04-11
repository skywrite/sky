import clone from '../clone.ts'

export default function addDays(date: Date, days: number): Date {
  const newDate = clone(date)
  newDate.setDate(newDate.getDate() + days)
  return newDate
}
