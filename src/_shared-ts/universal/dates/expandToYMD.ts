/**
 * Expand a partial date to a full `YYYY-MM-DD` string.
 *
 * Missing parts come from `refDate`, a calendar day (`YYYY-MM-DD` string or
 * Temporal.PlainDate) defaulting to today: "27" keeps the reference month and
 * year, "8-27" keeps the year, "2025-08-27" passes through.
 *
 * Dates that do not exist on the calendar (Feb 29 of a non-leap year, month
 * 13, day 0) throw rather than rolling over to a neighboring real date, and a
 * written-out year must be 4 digits — JS Date's 26→1926 mapping is not
 * honored.
 */
export default function expandToYMD(input: string, refDate?: string | Temporal.PlainDate): string {
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

  const ref = typeof refDate === 'string' ? Temporal.PlainDate.from(refDate) : (refDate ?? Temporal.Now.plainDateISO())

  try {
    return Temporal.PlainDate.from(
      { year: year ?? ref.year, month: month ?? ref.month, day },
      { overflow: 'reject' },
    ).toString()
  } catch (err) {
    throw new Error(`expandToYMD(): ${input} is not a date on the calendar: ${(err as Error).message}`)
  }
}
