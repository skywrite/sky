/**
 * The sky week — the notebook's unit of planning and layout. NOT an ISO week.
 *
 * Weeks start Monday. Every day belongs to a week in its own calendar year, so
 * boundary weeks are clipped into buckets: W00 holds January days that ISO puts
 * in the previous year's final week, and W53 holds December days that ISO puts
 * in the next year's week 1 (or a genuine ISO week 53 in long years). Mid-year,
 * sky and ISO numbers agree; where they diverge, the sky label (`W00`, or `W53`
 * in a 52-week ISO year) is invalid as ISO, so it can't be misread as ISO.
 *
 * A boundary week has two extents, exposed separately: `start`/`end`/`days` are
 * the true Monday–Sunday week (which may cross the year line), while
 * `startInYear`/`endInYear` clip to the week's own year — the directory view.
 * `year` is stored identity, not derived: W00-2027 starts on 2026-12-28.
 * `contains` uses bucket membership — every date belongs to exactly one Week.
 *
 * `Week.of` projects datetimes to their date part without normalization, so an
 * extended-hours time (`25:30`) resolves to the week of the day it started.
 * If you're holding a bare week number you probably want a Week instead;
 * `PlainDate.weekOfYear` is the ISO number and only agrees mid-year.
 */
import { REGEX_YMD_EXACT } from '#universal/dates/mod.ts'
import PlainDate from '../PlainDate/mod.ts'
import PlainDateTime from '../PlainDateTime/mod.ts'
import ZonedDateTime from '../ZonedDateTime/mod.ts'

type WeekOfInput = PlainDate | PlainDateTime | ZonedDateTime | string

function toPlainDate(value: WeekOfInput): PlainDate {
  if (value instanceof ZonedDateTime) return value.plainDateTime.plainDate
  if (value instanceof PlainDateTime) return value.plainDate
  if (value instanceof PlainDate) return value
  if (!REGEX_YMD_EXACT.test(value)) {
    throw new Error(`Invalid date format: "${value}". Expected YMD format (e.g., "2026-03-15")`)
  }
  return new PlainDate(value)
}

function skyWeekNumber(date: PlainDate): number {
  const isoWeek = date.weekOfYear
  // January days in the previous ISO year's last week → W00
  if (date.month === 1 && isoWeek >= 52) return 0
  // December days in the next ISO year's week 1 → W53
  if (date.month === 12 && isoWeek === 1) return 53
  return isoWeek
}

function firstNumberOfYear(year: number): number {
  return skyWeekNumber(new PlainDate(year, 1, 1))
}

// Monday of week `number`, derived from W01's Monday (the week containing Jan 4);
// the formula holds for W00 as well (number - 1 = -1 steps one week back)
function mondayOf(year: number, number: number): PlainDate {
  const jan4 = new PlainDate(year, 1, 4)
  const mondayOfW01 = jan4.addDays(-(jan4.dayOfWeek - 1))
  return mondayOfW01.addDays((number - 1) * 7)
}

export default class Week {
  public readonly year: number
  public readonly number: number

  private constructor(year: number, number: number) {
    this.year = year
    this.number = number
  }

  static of(value: WeekOfInput): Week {
    const date = toPlainDate(value)
    return new Week(date.year, skyWeekNumber(date))
  }

  /** Construct from identity, validating the week exists in that year. */
  static from(year: number, number: number): Week {
    if (!Number.isInteger(year) || !Number.isInteger(number)) {
      throw new Error(`Invalid week: year and number must be integers (got ${year}, ${number})`)
    }
    const first = firstNumberOfYear(year)
    const last = Week.lastOfYear(year)
    if (number < first || number > last) {
      throw new Error(`Week W${number} does not exist in ${year} (valid: W${first}-W${last})`)
    }
    return new Week(year, number)
  }

  /** Parse `'34'`, `'W34'`, or `'2027-W02'`; bare numbers need a context year. */
  static parse(input: string, contextYear?: number): Week {
    const trimmed = input.trim()

    const longForm = trimmed.match(/^(\d{4})-[Ww](\d{1,2})$/)
    if (longForm) return Week.from(Number(longForm[1]), Number(longForm[2]))

    const shortForm = trimmed.match(/^[Ww]?(\d{1,2})$/)
    if (shortForm) {
      if (contextYear === undefined) {
        throw new Error(`Bare week number "${input}" needs a context year`)
      }
      return Week.from(contextYear, Number(shortForm[1]))
    }

    throw new Error(`Invalid week format: "${input}". Expected "34", "W34", or "2027-W02"`)
  }

  /** Last week number of the year — 52, or 53 (genuine or overflow bucket). */
  static lastOfYear(year: number): number {
    return skyWeekNumber(new PlainDate(year, 12, 31))
  }

  /** Monday of the true week — may lie in the previous calendar year. */
  get start(): PlainDate {
    return mondayOf(this.year, this.number)
  }

  /** Sunday of the true week — may lie in the next calendar year. */
  get end(): PlainDate {
    return this.start.addDays(6)
  }

  /** The 7 dates of the true Monday–Sunday week. */
  get days(): PlainDate[] {
    const start = this.start
    return Array.from({ length: 7 }, (_, i) => start.addDays(i))
  }

  /** `start` clipped to Jan 1 of this week's own year — the bucket view. */
  get startInYear(): PlainDate {
    const jan1 = new PlainDate(this.year, 1, 1)
    return PlainDate.compare(this.start, jan1) < 0 ? jan1 : this.start
  }

  /** `end` clipped to Dec 31 of this week's own year — the bucket view. */
  get endInYear(): PlainDate {
    const dec31 = new PlainDate(this.year, 12, 31)
    return PlainDate.compare(this.end, dec31) > 0 ? dec31 : this.end
  }

  /** Bucket membership — every date belongs to exactly one Week. */
  contains(value: WeekOfInput): boolean {
    return Week.of(value).equals(this)
  }

  next(): Week {
    if (this.number + 1 <= Week.lastOfYear(this.year)) return Week.from(this.year, this.number + 1)
    return Week.from(this.year + 1, firstNumberOfYear(this.year + 1))
  }

  previous(): Week {
    if (this.number - 1 >= firstNumberOfYear(this.year)) return Week.from(this.year, this.number - 1)
    return Week.from(this.year - 1, Week.lastOfYear(this.year - 1))
  }

  equals(other: Week): boolean {
    return this.year === other.year && this.number === other.number
  }

  toString(): string {
    return `${this.year}-W${String(this.number).padStart(2, '0')}`
  }
}

export { Week }
