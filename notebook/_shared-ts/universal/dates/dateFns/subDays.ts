import addDays from './addDays.ts'

export default function subDays(date: Date, amount: number): Date {
  return addDays(date, -amount)
}
