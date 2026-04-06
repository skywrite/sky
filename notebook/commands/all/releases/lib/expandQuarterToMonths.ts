export default function expandQuarterToMonths(quarter: number): number[] {
  const months: number[] = [] // JS month numbers

  const startMonth = (quarter - 1) * 3
  for (let i = startMonth; i < startMonth + 3; ++i) {
    months.push(i)
  }

  return months
}
