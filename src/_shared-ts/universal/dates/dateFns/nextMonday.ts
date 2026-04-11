import nextDay from './nextDay.ts'

export default function nextMonday(date: Date): Date {
  return nextDay(date, 1)
}
