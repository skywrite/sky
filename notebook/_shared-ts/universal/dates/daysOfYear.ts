import isLeapYear from './isLeapYear.ts'

function numberOfDaysInYear(year: number): number {
  return isLeapYear(year) ? 366 : 365
}

export default function daysOfYear(year: number): Date[] {
  const daysCount = numberOfDaysInYear(year)

  const days: Date[] = []
  for (let i = 1; i <= daysCount; ++i) {
    days.push(new Date(year, 0, i))
  }

  return days
}
