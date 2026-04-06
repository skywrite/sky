import PlainDate from '../PlainDate/mod.ts'

export default class PlainYearMonth {
  public readonly year: number
  public readonly month: number

  constructor()
  constructor(date: Date)
  constructor(yearMonthString: string)
  constructor(year: number, month: number)
  constructor(plainDate: PlainDate)
  constructor(yearOrDateOrString?: number | Date | string | PlainDate, month?: number) {
    if (yearOrDateOrString === undefined) {
      // No arguments - use current month
      const now = new Date()
      this.year = now.getFullYear()
      this.month = now.getMonth() + 1
    } else if (yearOrDateOrString instanceof PlainDate) {
      this.year = yearOrDateOrString.year
      this.month = yearOrDateOrString.month
    } else if (yearOrDateOrString instanceof Date) {
      this.year = yearOrDateOrString.getFullYear()
      this.month = yearOrDateOrString.getMonth() + 1
    } else if (typeof yearOrDateOrString === 'string') {
      // Parse "YYYY-MM" or "YYYY-MM-DD" format
      const match = yearOrDateOrString.match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/)
      if (!match) {
        throw new Error(`Invalid year-month string: ${yearOrDateOrString}`)
      }
      this.year = parseInt(match[1], 10)
      this.month = parseInt(match[2], 10)
      if (this.month < 1 || this.month > 12) {
        throw new Error(`Invalid month: ${this.month}`)
      }
    } else if (typeof yearOrDateOrString === 'number' && month !== undefined) {
      if (month < 1 || month > 12) {
        throw new Error(`Invalid month: ${month}`)
      }
      this.year = yearOrDateOrString
      this.month = month
    } else {
      throw new Error('Invalid arguments for PlainYearMonth constructor')
    }
  }

  /**
   * Static factory method to create PlainYearMonth from various input types
   */
  static from(
    input: PlainYearMonth | PlainDate | Date | string | { year: number | string; month: number | string },
  ): PlainYearMonth {
    if (input instanceof PlainYearMonth) {
      return new PlainYearMonth(input.year, input.month)
    }

    if (input instanceof PlainDate) {
      return new PlainYearMonth(input)
    }

    if (input instanceof Date) {
      return new PlainYearMonth(input)
    }

    if (typeof input === 'string') {
      return new PlainYearMonth(input)
    }

    if (typeof input === 'object' && 'year' in input && 'month' in input) {
      const year = typeof input.year === 'string' ? parseInt(input.year, 10) : input.year
      const month = typeof input.month === 'string' ? parseInt(input.month, 10) : input.month
      return new PlainYearMonth(year, month)
    }

    throw new Error('Invalid input for PlainYearMonth.from()')
  }

  /**
   * Compare two PlainYearMonth instances
   * Returns -1 if a < b, 0 if a === b, 1 if a > b
   */
  static compare(a: PlainYearMonth, b: PlainYearMonth): -1 | 0 | 1 {
    if (a.year !== b.year) return a.year < b.year ? -1 : 1
    if (a.month !== b.month) return a.month < b.month ? -1 : 1
    return 0
  }

  /**
   * Get the year as a zero-padded 4-digit string
   */
  get yearPadded(): string {
    return String(this.year).padStart(4, '0')
  }

  /**
   * Get the month as a zero-padded 2-digit string
   */
  get monthPadded(): string {
    return String(this.month).padStart(2, '0')
  }

  /**
   * Get the number of days in this month
   */
  get daysInMonth(): number {
    return new Date(this.year, this.month, 0).getDate()
  }

  /**
   * Check if the year is a leap year
   */
  get inLeapYear(): boolean {
    return (this.year % 4 === 0 && this.year % 100 !== 0) || this.year % 400 === 0
  }

  /**
   * Get string representation in YYYY-MM format
   */
  toString(): string {
    return `${this.yearPadded}-${this.monthPadded}`
  }

  /**
   * Check equality with another PlainYearMonth
   */
  equals(other: PlainYearMonth): boolean {
    return this.year === other.year && this.month === other.month
  }

  /**
   * Convert to PlainDate with specified day (defaults to 1)
   */
  toPlainDate(day: number = 1): PlainDate {
    return new PlainDate(this.year, this.month, day)
  }

  /**
   * Add months (returns new PlainYearMonth)
   */
  add(months: number): PlainYearMonth {
    let newMonth = this.month + months
    let newYear = this.year

    while (newMonth > 12) {
      newMonth -= 12
      newYear++
    }
    while (newMonth < 1) {
      newMonth += 12
      newYear--
    }

    return new PlainYearMonth(newYear, newMonth)
  }

  /**
   * Subtract months (returns new PlainYearMonth)
   */
  subtract(months: number): PlainYearMonth {
    return this.add(-months)
  }
}

export { PlainYearMonth }
