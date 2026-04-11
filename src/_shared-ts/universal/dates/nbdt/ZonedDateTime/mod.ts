import PlainDateTime from '../PlainDateTime/mod.ts'
import currentTimezoneIANA from '../../timezones/currentTimezoneIANA.ts'
import timezoneOffset from '../../timezones/timezoneOffset.ts'
import timezoneToUTCOffsetInHours from '../../timezones/timezoneToUTCOffsetInHours.ts'

/*
  Purpose:

  ZonedDateTime extends PlainDateTime with timezone awareness.
  This is crucial for the Notebook system during travel scenarios
  where users need to:
  - Start a new day in a different timezone
  - Track when they crossed timezone boundaries
  - Handle the arbitrary nature of "day boundaries" during travel

  Supports the notebook's core concept that days are human-perceived
  periods that can span multiple calendar days and timezones.
*/

export type ZonedDateTimeConstructorOptions = {
  date: string
  time?: string
  timezone?: string
}

export default class ZonedDateTime {
  // The underlying PlainDateTime
  public readonly plainDateTime: PlainDateTime
  // IANA timezone identifier (e.g., "America/Los_Angeles", "Asia/Hong_Kong")
  public readonly timezone: string
  // Offset from UTC in hours (e.g., -8 for PST, +8 for HKT)
  public readonly offset: number

  constructor()
  constructor(dateTime: string, timezone?: string)
  constructor(dateTime: Date, timezone?: string)
  constructor(dateTime: PlainDateTime, timezone?: string)
  constructor(dateTime: ZonedDateTimeConstructorOptions)

  constructor(dateTime?: string | Date | PlainDateTime | ZonedDateTimeConstructorOptions, timezone?: string) {
    // No arguments - current time in current timezone
    if (!dateTime) {
      this.plainDateTime = new PlainDateTime()
      this.timezone = currentTimezoneIANA()
      this.offset = timezoneOffset()
      return
    }

    // ZonedDateTimeConstructorOptions
    if (
      typeof dateTime === 'object' &&
      !(dateTime instanceof PlainDateTime) &&
      !(dateTime instanceof Date) &&
      'date' in dateTime
    ) {
      this.plainDateTime = new PlainDateTime(dateTime)
      this.timezone = dateTime.timezone || currentTimezoneIANA()
      this.offset = this.calculateOffset(this.timezone)
      return
    }

    // PlainDateTime + timezone
    if (dateTime instanceof PlainDateTime) {
      this.plainDateTime = dateTime
      this.timezone = timezone || currentTimezoneIANA()
      this.offset = this.calculateOffset(this.timezone)
      return
    }

    // String or Date + timezone
    if (typeof dateTime === 'string') {
      this.plainDateTime = new PlainDateTime(dateTime)
    } else {
      this.plainDateTime = new PlainDateTime(dateTime as Date)
    }
    this.timezone = timezone || currentTimezoneIANA()
    this.offset = this.calculateOffset(this.timezone)
  }

  // Calculate offset for a given timezone
  private calculateOffset(tz: string): number {
    // Create a JavaScript Date from our PlainDateTime
    // Note: This may fail for extended hours, but we handle that separately
    const [year, month, day] = this.plainDateTime.date.split('-').map(Number)
    const [hours, minutes] = this.plainDateTime.time.split(':').map(Number)

    // For extended hours, use the base day and calculate offset for that
    const baseHours = hours % 24
    const refDate = new Date(year, month - 1, day, baseHours, minutes)

    // Add extra days if we have extended hours
    if (hours >= 24) {
      refDate.setDate(refDate.getDate() + Math.floor(hours / 24))
    }

    // Use our proper timezone offset function
    return timezoneToUTCOffsetInHours(tz, refDate)
  }

  // Convert to a different timezone (keeping the same instant)
  // Shows what the wall clock time would be in the target timezone
  // e.g., 3 PM in NYC becomes 2 PM in Chicago (same moment, different local time)
  inTimeZone(timezone: string): ZonedDateTime {
    // Calculate the time difference between timezones
    const currentOffset = this.offset
    const newOffset = this.calculateOffset(timezone)
    const offsetDiff = newOffset - currentOffset

    // Apply the offset to get the new local time
    const adjustedDateTime = this.plainDateTime.addHours(offsetDiff)

    // Keep extended/negative hours to preserve the notebook's logical day concept
    // Don't normalize here - let the caller decide if they want normalized time
    return new ZonedDateTime(adjustedDateTime, timezone)
  }

  // Assign a new timezone (keeping the same PlainDateTime)
  // This changes the instant - e.g., 3 PM becomes 3 PM in new timezone
  // Mirrors Temporal.ZonedDateTime.withTimeZone()
  withTimeZone(timezone: string): ZonedDateTime {
    return new ZonedDateTime(this.plainDateTime, timezone)
  }

  // Convert to UTC
  toUTC(): ZonedDateTime {
    return this.inTimeZone('UTC')
  }

  // Get the local PlainDateTime in the current timezone
  toLocal(): PlainDateTime {
    return this.plainDateTime
  }

  // Convenience getters that pass through to the underlying PlainDateTime
  get date(): string {
    return this.plainDateTime.date
  }

  get time(): string {
    return this.plainDateTime.time
  }

  // Get a JavaScript Date for just the date (no time) in this timezone
  // Note: The returned Date will be interpreted in the system's timezone
  toDayDateValue(): Date {
    return this.plainDateTime.toDayDateValue()
  }

  // Get a JavaScript Date representing this exact instant in time
  // This accounts for the timezone offset to return the correct moment
  toTimeDateValue(): Date {
    // Get the base date/time from PlainDateTime
    const [year, month, day] = this.plainDateTime.date.split('-').map(Number)
    const [hours, minutes] = this.plainDateTime.time.split(':').map(Number)

    // For extended hours, we need to handle the day offset first
    let actualDay = day
    let actualHours = hours

    if (hours >= 24) {
      // Calculate how many days forward we are
      const daysForward = Math.floor(hours / 24)
      actualDay += daysForward
      actualHours = hours % 24
    } else if (hours < 0) {
      // Handle negative hours (going backward)
      const daysBackward = Math.ceil(Math.abs(hours) / 24)
      actualDay -= daysBackward
      actualHours = 24 + (hours % 24)
      if (actualHours === 24) actualHours = 0
    }

    // Now convert to UTC by subtracting the timezone offset
    // If we're at 15:00 in LA (UTC-7), we need 15:00 - (-7) = 22:00 UTC
    const utcHours = actualHours - this.offset

    // Create the UTC date
    const adjustedDate = new Date(Date.UTC(year, month - 1, actualDay, utcHours, minutes))

    return adjustedDate
  }

  // Clone with same timezone
  clone(): ZonedDateTime {
    return new ZonedDateTime(this.plainDateTime.clone(), this.timezone)
  }

  // Add hours (respects extended hours for logical days)
  addHours(hours: number): ZonedDateTime {
    const newPlainDateTime = this.plainDateTime.addHours(hours)
    return new ZonedDateTime(newPlainDateTime, this.timezone)
  }

  // Normalize extended hours (e.g., 31:11 becomes 07:11 next day)
  normalize(): ZonedDateTime {
    const normalizedPlainDateTime = this.plainDateTime.normalize()
    return new ZonedDateTime(normalizedPlainDateTime, this.timezone)
  }

  // Check if this is the same instant as another ZonedDateTime
  isSameInstant(other: ZonedDateTime): boolean {
    const thisUTC = this.toUTC()
    const otherUTC = other.toUTC()
    return thisUTC.plainDateTime.toString() === otherUTC.plainDateTime.toString()
  }

  // Calculate milliseconds between this and another ZonedDateTime
  // Returns positive if other is after this, negative if before
  millisBetween(other: ZonedDateTime): number {
    // Convert both to UTC for accurate comparison
    const thisUTC = this.toUTC()
    const otherUTC = other.toUTC()

    // Extract components from UTC times
    const [thisYear, thisMonth, thisDay] = thisUTC.date.split('-').map(Number)
    const [thisHours, thisMinutes] = thisUTC.time.split(':').map(Number)

    const [otherYear, otherMonth, otherDay] = otherUTC.date.split('-').map(Number)
    const [otherHours, otherMinutes] = otherUTC.time.split(':').map(Number)

    // Handle extended hours by normalizing
    let thisActualDay = thisDay
    let thisActualHours = thisHours
    if (thisHours >= 24) {
      thisActualDay += Math.floor(thisHours / 24)
      thisActualHours = thisHours % 24
    }

    let otherActualDay = otherDay
    let otherActualHours = otherHours
    if (otherHours >= 24) {
      otherActualDay += Math.floor(otherHours / 24)
      otherActualHours = otherHours % 24
    }

    // Create UTC timestamps
    const thisMillis = Date.UTC(thisYear, thisMonth - 1, thisActualDay, thisActualHours, thisMinutes)
    const otherMillis = Date.UTC(otherYear, otherMonth - 1, otherActualDay, otherActualHours, otherMinutes)

    return otherMillis - thisMillis
  }

  // Calculate hours between this and another ZonedDateTime
  // Returns positive if other is after this, negative if before
  hoursBetween(other: ZonedDateTime): number {
    return this.millisBetween(other) / (1000 * 60 * 60)
  }

  // Calculate minutes between this and another ZonedDateTime
  minutesBetween(other: ZonedDateTime): number {
    return this.millisBetween(other) / (1000 * 60)
  }

  // Calculate days between this and another ZonedDateTime
  daysBetween(other: ZonedDateTime): number {
    return this.millisBetween(other) / (1000 * 60 * 60 * 24)
  }

  // TODO: Not Temporal-compatible. Temporal uses: 2026-01-22T09:30:00-06:00[America/Chicago]
  // Our format: 2026-01-22 09:30 America/Chicago
  // Need to change to Temporal format for interop.
  toString(): string {
    return `${this.plainDateTime.toString()} ${this.timezone}`
  }

  // Format as ISO string with offset
  toISOString(): string {
    const offsetHours = Math.floor(Math.abs(this.offset))
    const offsetMinutes = Math.round((Math.abs(this.offset) - offsetHours) * 60)
    const offsetSign = this.offset >= 0 ? '+' : '-'
    const offsetString = `${offsetSign}${offsetHours.toString().padStart(2, '0')}:${offsetMinutes
      .toString()
      .padStart(2, '0')}`
    return `${this.plainDateTime.toString()}${offsetString}`
  }

  // Static factory methods
  static now(timezone?: string): ZonedDateTime {
    return new ZonedDateTime(new PlainDateTime(), timezone)
  }

  static fromString(dateTimeStr: string, timezone?: string): ZonedDateTime {
    // Parse strings like "2024-03-15 14:30 America/Los_Angeles"
    const parts = dateTimeStr.split(' ')
    if (parts.length >= 3 && !timezone) {
      // Assume last part is timezone if it contains a slash
      const lastPart = parts[parts.length - 1]
      if (lastPart.includes('/')) {
        const dateTime = parts.slice(0, -1).join(' ')
        return new ZonedDateTime(dateTime, lastPart)
      }
    }
    return new ZonedDateTime(dateTimeStr, timezone)
  }
}
