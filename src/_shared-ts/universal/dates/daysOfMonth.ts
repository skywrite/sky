import getDaysInMonth from './dateFns/getDaysInMonth.ts'

export default function daysOfMonth(year: number, jsMonthIndex: number): Date[] {
  const firstDayOfMonth = new Date(year, jsMonthIndex, 1)
  const daysInMonth = getDaysInMonth(firstDayOfMonth)

  const days: Date[] = []

  for (let i = 1; i <= daysInMonth; ++i) {
    const date = new Date(year, jsMonthIndex, i)
    days.push(date)
  }

  return days
}
