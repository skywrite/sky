import PlainDate from '../PlainDate/mod.ts'
import PlainYearMonth from '../PlainYearMonth/mod.ts'

export default class PlainYear {
  public readonly year: number

  constructor()
  constructor(date: Date)
  constructor(yearString: string)
  constructor(year: number)
  constructor(plainDate: PlainDate)
  constructor(plainYearMonth: PlainYearMonth)
  constructor(yearOrDateOrString?: number | Date | string | PlainDate | PlainYearMonth) {
    if (yearOrDateOrString === undefined) {
      // No arguments - use current year
      this.year = new Date().getFullYear()
    } else if (yearOrDateOrString instanceof PlainDate) {
      this.year = yearOrDateOrString.year
    } else if (yearOrDateOrString instanceof PlainYearMonth) {
      this.year = yearOrDateOrString.year
    } else if (yearOrDateOrString instanceof Date) {
      this.year = yearOrDateOrString.getFullYear()
    } else if (typeof yearOrDateOrString === 'string') {
      // Parse "YYYY", "YYYY-MM", or "YYYY-MM-DD" format
      const match = yearOrDateOrString.match(/^(\d{4})(?:-\d{1,2})?(?:-\d{1,2})?$/)
      if (!match) {
        throw new Error(`Invalid year string: ${yearOrDateOrString}`)
      }
      this.year = parseInt(match[1], 10)
    } else if (typeof yearOrDateOrString === 'number') {
      this.year = yearOrDateOrString
    } else {
      throw new Error('Invalid arguments for PlainYear constructor')
    }
  }

  /**
   * Static factory method to create PlainYear from various input types
   */
  static from(
    input: PlainYear | PlainYearMonth | PlainDate | Date | string | number | { year: number | string },
  ): PlainYear {
    if (input instanceof PlainYear) {
      return new PlainYear(input.year)
    }

    if (input instanceof PlainYearMonth) {
      return new PlainYear(input)
    }

    if (input instanceof PlainDate) {
      return new PlainYear(input)
    }

    if (input instanceof Date) {
      return new PlainYear(input)
    }

    if (typeof input === 'string') {
      return new PlainYear(input)
    }

    if (typeof input === 'number') {
      return new PlainYear(input)
    }

    if (typeof input === 'object' && 'year' in input) {
      const year = typeof input.year === 'string' ? parseInt(input.year, 10) : input.year
      return new PlainYear(year)
    }

    throw new Error('Invalid input for PlainYear.from()')
  }

  /**
   * Compare two PlainYear instances
   * Returns -1 if a < b, 0 if a === b, 1 if a > b
   */
  static compare(a: PlainYear, b: PlainYear): -1 | 0 | 1 {
    if (a.year !== b.year) return a.year < b.year ? -1 : 1
    return 0
  }

  /**
   * Get the year as a zero-padded 4-digit string
   */
  get yearPadded(): string {
    return String(this.year).padStart(4, '0')
  }

  /**
   * Check if the year is a leap year
   */
  get inLeapYear(): boolean {
    return (this.year % 4 === 0 && this.year % 100 !== 0) || this.year % 400 === 0
  }

  /**
   * Get the number of days in this year
   */
  get daysInYear(): number {
    return this.inLeapYear ? 366 : 365
  }

  /**
   * Get string representation in YYYY format
   */
  toString(): string {
    return this.yearPadded
  }

  /**
   * Check equality with another PlainYear
   */
  equals(other: PlainYear): boolean {
    return this.year === other.year
  }

  /**
   * Convert to PlainYearMonth with specified month (defaults to 1)
   */
  toPlainYearMonth(month: number = 1): PlainYearMonth {
    return new PlainYearMonth(this.year, month)
  }

  /**
   * Convert to PlainDate with specified month and day (defaults to Jan 1)
   */
  toPlainDate(month: number = 1, day: number = 1): PlainDate {
    return new PlainDate(this.year, month, day)
  }

  /**
   * Add years (returns new PlainYear)
   */
  add(years: number): PlainYear {
    return new PlainYear(this.year + years)
  }

  /**
   * Subtract years (returns new PlainYear)
   */
  subtract(years: number): PlainYear {
    return new PlainYear(this.year - years)
  }
}

export { PlainYear }
