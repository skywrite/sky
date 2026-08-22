import dateTo24H from '../../dateTo24H.ts'
import YMD from '../../ymd.ts'
import Duration from '../Duration/mod.ts'
import PlainDate from '../PlainDate/mod.ts'
import formatTime from './_formatTime.ts'
import _parseDateTimeString from './_parseDateTimeString.ts'

/*
  Purpose:

  To encode and handle days and times that expand > 24

  Does not support timezones. This may or may not be implemented.

  Does not support seconds or milliseconds.
*/

export type PlainDateTimeConstructorOptions = { date: string; time?: string }

export default class PlainDateTime {
  // Internal PlainDate for date operations
  private readonly _date: PlainDate
  // HH:MM (HH can be up to 99)
  public readonly time: string

  // Public access to the PlainDate
  get plainDate(): PlainDate {
    return this._date
  }

  // YYYY-MM-DD - for backward compatibility
  get date(): string {
    return this._date.ymd
  }

  constructor()
  constructor(dateTime: string)
  constructor(dateTime: Date)
  constructor(dateTime: PlainDate)
  constructor(dateTime: PlainDateTimeConstructorOptions)
  constructor(time: string, date?: string) // TODO: deprecate
  constructor(time: string, date?: PlainDate)
  constructor(time: Date, date?: Date) // TODO: deprecate

  constructor(time?: string | Date | PlainDate | PlainDateTimeConstructorOptions, date?: string | Date | PlainDate) {
    if (!time && !date) {
      const now = new Date()
      this._date = new PlainDate(now)
      this.time = dateTo24H(now)
      return
    }

    if (!date && time instanceof PlainDate) {
      // PlainDate only - use midnight as time
      this._date = time
      this.time = '00:00'
      return
    }

    if (!date && typeof time === 'string') {
      const [resDate, resTime] = _parseDateTimeString(time)
      this._date = new PlainDate(resDate)
      this.time = resTime
      return
    }

    if (typeof time === 'string' && typeof date === 'string') {
      const [resDate, resTime] = _parseDateTimeString(`${date} ${time}`)
      this._date = new PlainDate(resDate)
      this.time = formatTime(resTime)
      return
    }

    if (typeof time === 'string' && date instanceof PlainDate) {
      // Time string with PlainDate
      this._date = date
      this.time = formatTime(time)
      return
    }

    if (!date && time instanceof Date) {
      this._date = new PlainDate(time)
      this.time = dateTo24H(time)
      return
    }

    if (time instanceof Date && date instanceof Date) {
      this._date = new PlainDate(date)
      this.time = dateTo24H(time, date)
      return
    }

    if (!(time instanceof Date) && !(time instanceof PlainDate) && typeof time === 'object' && time && time.date) {
      this._date = new PlainDate(time.date)

      if (typeof time.time === 'string') {
        this.time = formatTime(time.time)
      } else {
        this.time = '00:00'
      }

      return
    }

    throw new Error('PlainDateTime unhandled constructor parameter types.')
  }

  // intended for timezone calculation / shifting
  // when traveling
  addHours(hoursOffset: number): PlainDateTime {
    const [hours, minutes] = this.time.split(':').map(Number)
    const offsetInMinutes = Math.round(hoursOffset * 60) // Convert decimal hour to minutes
    const totalMinutes = hours * 60 + minutes + offsetInMinutes

    // Simple calculation - let both be negative if needed
    const newHours = Math.floor(totalMinutes / 60)
    const newMinutes = totalMinutes - newHours * 60 // This ensures proper remainder

    // Format the time, handling negative minutes
    let timeStr
    if (newHours < 0 && newMinutes < 0) {
      // Both negative: -6:-4
      timeStr = `${newHours}:${Math.abs(newMinutes)}`
    } else {
      timeStr = `${newHours}:${Math.abs(newMinutes)}`
    }

    const newDt = new PlainDateTime(timeStr, this.date)
    return newDt
  }

  clone(): PlainDateTime {
    return PlainDateTime.fromString(this.toString())
  }

  // Normalize extended hours (e.g., 31:11 becomes 07:11 next day)
  // or negative hours (e.g., -1:30 becomes 22:30 previous day)
  normalize(): PlainDateTime {
    const timeParts = this.time.split(':')
    const hours = parseInt(timeParts[0])
    const minutes = parseInt(timeParts[1])

    // Note: When time is negative like -7:56, we interpret this as
    // "7 hours and 56 minutes before midnight", which equals
    // 24:00 - 7:56 = 16:04 the previous day (not 17:56!).
    // The minutes are already properly signed from addHours.

    // If hours are already in normal range, return as-is
    if (hours >= 0 && hours < 24) {
      return this
    }

    // Calculate total minutes for easier calculation
    const totalMinutes = hours * 60 + minutes

    // Calculate day adjustment and normalized time
    let dayAdjustment = 0
    let normalizedMinutes = totalMinutes

    if (totalMinutes >= 24 * 60) {
      // Positive overflow: multiple days forward
      dayAdjustment = Math.floor(totalMinutes / (24 * 60))
      normalizedMinutes = totalMinutes % (24 * 60)
    } else if (totalMinutes < 0) {
      // Negative: go back days
      dayAdjustment = Math.floor(totalMinutes / (24 * 60)) // This will be negative
      normalizedMinutes = totalMinutes % (24 * 60)
      if (normalizedMinutes < 0) {
        normalizedMinutes += 24 * 60
      }
    }

    const normalizedHours = Math.floor(normalizedMinutes / 60)
    const finalMinutes = normalizedMinutes % 60

    // Adjust the date using PlainDate
    const adjustedDate = this._date.addDays(dayAdjustment)

    // Format the normalized time
    const newTime = `${String(normalizedHours).padStart(2, '0')}:${String(finalMinutes).padStart(2, '0')}`

    return new PlainDateTime(newTime, adjustedDate.ymd)
  }

  /**
   * Wall-clock Duration from this to `other` — Temporal.PlainDateTime.until,
   * balanced to hours (nbdt Duration's largest unit; Temporal defaults to
   * days). Zone-free: both sides read on the same (unspecified) clock, so
   * the delta is exact except across a DST shift between them — the right
   * tool for staleness timers over stored zone-less timestamps. Extended
   * and negative hours normalize first. For real instants, use
   * ZonedDateTime.epochMilliseconds; a zone-less datetime deliberately has
   * no epoch accessor (Temporal makes the same refusal).
   */
  until(other: PlainDateTime): Duration {
    const wallClockUTC = (dt: PlainDateTime): number => {
      const n = dt.normalize()
      const [year, month, day] = n.date.split('-').map(Number)
      const [hours, minutes] = n.time.split(':').map(Number)
      return Date.UTC(year, month - 1, day, hours, minutes)
    }
    const totalSeconds = Math.round((wallClockUTC(other) - wallClockUTC(this)) / 1000)
    const sign = totalSeconds < 0 ? -1 : 1
    const abs = Math.abs(totalSeconds)
    return new Duration(sign * Math.floor(abs / 3600), sign * (Math.floor(abs / 60) % 60), sign * (abs % 60))
  }

  /** Temporal.PlainDateTime.since — `until` with the direction reversed. */
  since(other: PlainDateTime): Duration {
    return other.until(this)
  }

  toString(): string {
    return `${this.date} ${this.time}`
  }

  static fromString(dateTime: string): PlainDateTime {
    return new PlainDateTime(dateTime)
  }
}
