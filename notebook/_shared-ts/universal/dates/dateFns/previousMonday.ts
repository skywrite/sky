import previousDay from './previousDay.ts'

export default function previousMonday(date: Date): Date {
  return previousDay(date, 1)
}
