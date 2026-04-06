import YMD from './ymd.ts'

export default function expandToYMD(input: string, refDate = new Date()): string {
  const parts: string[] = input.split('-')
  const nums = parts.map((part) => parseInt(part, 10))

  // NaN check
  const allNums = nums.reduce((allNum, num) => {
    return allNum && !Number.isNaN(num)
  }, true)

  if (!allNums) throw new Error(`expandToYMD(): One component of ${input} is NaN.`)

  // at minimum, we have the day, then month, then year
  const [day, month, year] = nums.reverse()

  const properYear = year ?? refDate.getFullYear()
  let properMonth = refDate.getMonth()
  if (month) properMonth = month - 1

  const date = new Date(properYear, properMonth, day)

  return YMD(date).join('-')
}
