import { expandToYMD, YMD, ymdToDate } from '#universal/dates/mod.ts'

export default class PlainDate {
  public readonly year: number
  public readonly month: number
  public readonly day: number

  constructor()
  constructor(date: Date)
  constructor(dateString: string)
  constructor(year: number, month: number, day: number)
  constructor(yearOrDateOrString?: number | Date | string, month?: number, day?: number) {
    let date: Date

    if (yearOrDateOrString === undefined) {
      // No arguments - use today
      date = new Date()
    } else if (yearOrDateOrString instanceof Date) {
      // From Date object
      date = new Date(yearOrDateOrString)
    } else if (typeof yearOrDateOrString === 'string') {
      // From string (YMD or partial)
      // First, check if it's a full YMD string that we should validate
      const ymdMatch = yearOrDateOrString.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
      if (ymdMatch) {
        // Full YMD - validate before expanding
        const [_, yearStr, monthStr, dayStr] = ymdMatch
        const testDate = new Date(Number(yearStr), Number(monthStr) - 1, Number(dayStr))
        if (
          testDate.getFullYear() !== Number(yearStr) ||
          testDate.getMonth() + 1 !== Number(monthStr) ||
          testDate.getDate() !== Number(dayStr)
        ) {
          throw new Error(`Invalid date: ${yearOrDateOrString}`)
        }
      }

      const expandedYMD = expandToYMD(yearOrDateOrString)
      date = ymdToDate(expandedYMD)
    } else if (typeof yearOrDateOrString === 'number' && month !== undefined && day !== undefined) {
      // From components
      date = new Date(yearOrDateOrString, month - 1, day)
    } else {
      throw new Error('Invalid arguments for PlainDate constructor')
    }

    // Validate the date
    if (isNaN(date.getTime())) {
      throw new Error('Invalid date')
    }

    // Extract components
    this.year = date.getFullYear()
    this.month = date.getMonth() + 1
    this.day = date.getDate()

    // Additional validation: check if the components match what was requested
    // This catches cases like Feb 30 which JS Date auto-corrects to March 2
    if (typeof yearOrDateOrString === 'number' && month !== undefined && day !== undefined) {
      if (this.year !== yearOrDateOrString || this.month !== month || this.day !== day) {
        throw new Error(
          `Invalid date: ${yearOrDateOrString}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        )
      }
    }
  }

  /**
   * Static factory method to create PlainDate from various input types
   * High-level API similar to Temporal.PlainDate.from()
   *
   * @param input - Can be:
   *   - PlainDate instance (returns copy)
   *   - Date object
   *   - String in YMD format
   *   - Object with { year, month, day } properties (values can be numbers or strings)
   */
  static from(
    input: PlainDate | Date | string | { year: number | string; month: number | string; day: number | string },
  ): PlainDate {
    if (input instanceof PlainDate) {
      return new PlainDate(input.year, input.month, input.day)
    }

    if (input instanceof Date) {
      return new PlainDate(input)
    }

    if (typeof input === 'string') {
      return new PlainDate(input)
    }

    if (typeof input === 'object' && 'year' in input && 'month' in input && 'day' in input) {
      const year = typeof input.year === 'string' ? parseInt(input.year, 10) : input.year
      const month = typeof input.month === 'string' ? parseInt(input.month, 10) : input.month
      const day = typeof input.day === 'string' ? parseInt(input.day, 10) : input.day
      return new PlainDate(year, month, day)
    }

    throw new Error('Invalid input for PlainDate.from()')
  }

  /**
   * Static factory method to create PlainDate from string
   */
  static fromString(dateString: string): PlainDate {
    return new PlainDate(dateString)
  }

  /**
   * Static factory method to get today's date
   */
  static today(): PlainDate {
    return new PlainDate()
  }

  /**
   * Compare two PlainDate instances
   * Returns -1 if a < b, 0 if a === b, 1 if a > b
   * Matches Temporal.PlainDate.compare() signature
   *
   * @example
   * // Sort dates ascending
   * dates.sort(PlainDate.compare)
   *
   * // Sort dates descending
   * dates.sort((a, b) => PlainDate.compare(b, a))
   */
  static compare(a: PlainDate, b: PlainDate): -1 | 0 | 1 {
    if (a.year !== b.year) return a.year < b.year ? -1 : 1
    if (a.month !== b.month) return a.month < b.month ? -1 : 1
    if (a.day !== b.day) return a.day < b.day ? -1 : 1
    return 0
  }

  /**
   * Get the year as a zero-padded 4-digit string (e.g., "2025")
   */
  get yearPadded(): string {
    return String(this.year).padStart(4, '0')
  }

  /**
   * Get the month as a zero-padded 2-digit string (e.g., "08")
   */
  get monthPadded(): string {
    return String(this.month).padStart(2, '0')
  }

  /**
   * Get the day as a zero-padded 2-digit string (e.g., "27")
   */
  get dayPadded(): string {
    return String(this.day).padStart(2, '0')
  }

  /**
   * Get the date in YYYY-MM-DD format
   */
  get ymd(): string {
    return `${this.yearPadded}-${this.monthPadded}-${this.dayPadded}`
  }

  /**
   * Get the date parts as a [year, month, day] array of padded strings
   * @returns Array of ['YYYY', 'MM', 'DD']
   */
  get ymdParts(): [string, string, string] {
    return [this.yearPadded, this.monthPadded, this.dayPadded]
  }

  /**
   * Get the short day name (e.g., "Mon", "Tue")
   */
  get dayShort(): string {
    return this.toDate().toLocaleDateString('en-us', { weekday: 'short' })
  }

  /**
   * Get the long day name (e.g., "Monday", "Tuesday")
   */
  get dayLong(): string {
    return this.toDate().toLocaleDateString('en-us', { weekday: 'long' })
  }

  /**
   * Get the day of week (1 = Monday, 2 = Tuesday, ..., 7 = Sunday)
   * Note: This matches Temporal PlainDate convention (ISO 8601)
   * Different from JavaScript Date which uses 0-6 with Sunday=0
   */
  get dayOfWeek(): number {
    const jsDay = this.toDate().getDay()
    // Convert from JS convention (0=Sunday) to ISO/Temporal (7=Sunday, 1=Monday)
    return jsDay === 0 ? 7 : jsDay
  }

  /**
   * Get the number of days in the current month
   * Note: This matches Temporal PlainDate.daysInMonth convention
   */
  get daysInMonth(): number {
    // Create date for the 0th day of next month (which gives us last day of current month)
    return new Date(this.year, this.month, 0).getDate()
  }

  /**
   * Check if the date is in a leap year
   * Note: This matches Temporal PlainDate.inLeapYear convention
   */
  get inLeapYear(): boolean {
    return (this.year % 4 === 0 && this.year % 100 !== 0) || this.year % 400 === 0
  }

  /**
   * Get the number of days in the current year
   * Note: This matches Temporal PlainDate.daysInYear convention
   */
  get daysInYear(): number {
    return this.inLeapYear ? 366 : 365
  }

  /**
   * Get the ISO week number of the year (1-53)
   * Note: This matches Temporal PlainDate.weekOfYear convention
   * ISO weeks start on Monday and the first week is the one containing January 4th
   */
  get weekOfYear(): number {
    // Use UTC to avoid DST issues when calculating week numbers
    // PlainDate represents a calendar date, so we work with UTC dates
    // to ensure consistent 24-hour periods in millisecond arithmetic
    const tempDate = new Date(Date.UTC(this.year, this.month - 1, this.day))

    // ISO week date weeks start on Monday, so correct the day number
    const dayNum = (tempDate.getUTCDay() + 6) % 7

    // Set to nearest Thursday: current date + 4 - current day number
    tempDate.setUTCDate(tempDate.getUTCDate() - dayNum + 3)

    // January 4th is always in week 1
    const yearStart = new Date(Date.UTC(tempDate.getUTCFullYear(), 0, 4))

    // Adjust to nearest Thursday
    const yearStartDayNum = (yearStart.getUTCDay() + 6) % 7
    yearStart.setUTCDate(yearStart.getUTCDate() - yearStartDayNum + 3)

    // Calculate week number
    // Use Math.round to handle any floating point precision issues
    const weekNum = 1 + Math.round((tempDate.getTime() - yearStart.getTime()) / (7 * 24 * 60 * 60 * 1000))

    return weekNum
  }

  /**
   * Convert to JavaScript Date object (time set to 00:00:00)
   */
  toDate(): Date {
    return new Date(this.year, this.month - 1, this.day)
  }

  /**
   * Get string representation (same as ymd)
   */
  toString(): string {
    return this.ymd
  }

  /**
   * Check equality with another PlainDate
   */
  equals(other: PlainDate): boolean {
    return this.year === other.year && this.month === other.month && this.day === other.day
  }

  /**
   * Add days to the date (returns new PlainDate)
   */
  addDays(days: number): PlainDate {
    const date = this.toDate()
    date.setDate(date.getDate() + days)
    return new PlainDate(date)
  }
}

export { PlainDate }
