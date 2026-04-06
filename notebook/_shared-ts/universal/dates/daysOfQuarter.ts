import getDaysInMonth from './dateFns/getDaysInMonth.ts'

export type Quarter = 1 | 2 | 3 | 4

export default function daysOfQuarter(year: number, quarter: Quarter | number): Date[] {
  const q = quarter - 1 // for weird JS month indexing
  const k = q * 3
  const jsMonthNums = [k, k + 1, k + 2]

  const days: Date[] = []
  jsMonthNums.forEach((monthNum) => {
    const month = new Date(year, monthNum, 1)
    const numberOfDaysInMonth = getDaysInMonth(month)
    for (let i = 0; i < numberOfDaysInMonth; ++i) {
      const day = new Date(year, monthNum, i + 1)
      days.push(day)
    }
  })

  return days
}
