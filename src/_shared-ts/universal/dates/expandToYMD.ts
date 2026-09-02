/**
 * Expand a partial date to a full `YYYY-MM-DD` string.
 *
 * Missing parts come from `refDate`, a calendar day (`YYYY-MM-DD` string or
 * anything with `year` and `month`) defaulting to today: "27" keeps the
 * reference month and year, "8-27" keeps the year, "2025-08-27" passes
 * through. Today is read only when a part is missing, the way the rest of
 * nbdt reads it — the local calendar day — so a full date needs nothing the
 * browser the front matter panel runs in might lack.
 *
 * Dates that do not exist on the calendar (Feb 29 of a non-leap year, month
 * 13, day 0) throw rather than rolling over to a neighboring real date, and a
 * written-out year must be 4 digits — JS Date's 26→1926 mapping is not
 * honored.
 */
export default function expandToYMD(input: string, refDate?: string | { year: number; month: number }): string {
  const parts: string[] = input.split('-')
  const nums = parts.map((part) => parseInt(part, 10))

  // NaN check
  const allNums = nums.reduce((allNum, num) => {
    return allNum && !Number.isNaN(num)
  }, true)

  if (!allNums) throw new Error(`expandToYMD(): One component of ${input} is NaN.`)
  if (parts.length > 3) throw new Error(`expandToYMD(): ${input} has more components than year-month-day.`)

  // at minimum, we have the day, then month, then year
  const [day, month, year] = nums.reverse()

  if (year !== undefined && !/^\d{4}$/.test(parts[0])) {
    throw new Error(`expandToYMD(): year in ${input} must be 4 digits.`)
  }

  let y = year
  let m = month
  if (y === undefined || m === undefined) {
    const ref = referenceDay(refDate)
    y ??= ref.year
    m ??= ref.month
  }
  if (day === undefined || !onCalendar(y, m, day)) {
    throw new Error(`expandToYMD(): ${input} is not a date on the calendar.`)
  }
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** The year and month missing parts come from: the reference given, or the local calendar day. */
function referenceDay(refDate: string | { year: number; month: number } | undefined): { year: number; month: number } {
  if (refDate === undefined) {
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() + 1 }
  }
  if (typeof refDate !== 'string') return { year: refDate.year, month: refDate.month }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(refDate)
  if (!match) throw new Error(`expandToYMD(): reference ${refDate} is not YYYY-MM-DD.`)
  return { year: Number(match[1]), month: Number(match[2]) }
}

/** Whether the day exists: months of 28 to 31 days, February by the leap-year rule. */
function onCalendar(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false
  if (month < 1 || month > 12 || day < 1) return false
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0
  return day <= days
}
