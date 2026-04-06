import { expandToYMD } from '#universal/dates/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'

export interface ParsePartialDateOptions {
  rejectFuture?: boolean
}

/**
 * Parse a partial date string into a PlainDate object.
 * Accepts formats like:
 * - "27" -> current month and year
 * - "8-27" or "08-27" -> specified month, current year
 * - "2025-08-27" -> full date
 *
 * @param input The partial or full date string
 * @param options Options for parsing behavior
 * @returns A PlainDate object
 * @throws Error if rejectFuture is true and date is in the future
 */
export function parsePartialDate(input: string | number, options: ParsePartialDateOptions = {}): PlainDate {
  // Convert to string if it's a number (CLI might pass "27" as number 27)
  const inputStr = String(input)
  const expandedYMD = expandToYMD(inputStr)
  const plainDate = new PlainDate(expandedYMD)

  if (options.rejectFuture) {
    const today = new PlainDate()
    const inputDate = plainDate.toDate()
    const todayDate = today.toDate()

    if (inputDate > todayDate) {
      throw new Error(`Cannot use future date: ${plainDate.ymd}`)
    }
  }

  return plainDate
}
