/**
 * Pattern matching system for recurring tasks
 *
 * Supported patterns:
 *
 * DAILY/WEEKLY:
 * - EVERY-DAY: Every day
 * - EVERY-WEEKDAY: Monday through Friday
 * - EVERY-WEEKEND: Saturday and Sunday
 * - EVERY-MON, EVERY-TUE, EVERY-WED, EVERY-THU, EVERY-FRI, EVERY-SAT, EVERY-SUN
 *
 * MONTHLY:
 * - MONTHLY-FIRST-MON: First Monday of the month
 * - MONTHLY-SECOND-TUE: Second Tuesday of the month
 * - MONTHLY-THIRD-WED: Third Wednesday of the month
 * - MONTHLY-FOURTH-THU: Fourth Thursday of the month
 * - MONTHLY-LAST-FRI: Last Friday of the month
 * - MONTHLY-LAST-WEEKEND: Last weekend of the month
 * - MONTHLY-1: 1st of every month
 * - MONTHLY-15: 15th of every month
 * - MONTHLY-31: 31st of every month (skips months without 31 days)
 * - MONTHLY-LAST: Last day of month
 * - MONTHLY-LAST-1: Second to last day of month
 * - MONTHLY-LAST-N: N days before month end
 *
 * QUARTERLY:
 * - QUARTERLY-FIRST-MON: First Monday of the quarter
 * - QUARTERLY-LAST-FRI: Last Friday of the quarter
 * - QUARTERLY-1: First day of quarter
 * - QUARTERLY-15: 15th day of quarter
 * - QUARTERLY-LAST: Last day of quarter
 * - QUARTERLY-LAST-N: N days before quarter end
 *
 * QUARTERLY-MONTH-BEFORE (month before each quarter: Dec, Mar, Jun, Sep):
 * - QUARTERLY-MONTH-BEFORE-FIRST-WED: First Wednesday of the pre-quarter month
 * - QUARTERLY-MONTH-BEFORE-THIRD-WED: Third Wednesday of the pre-quarter month
 * - QUARTERLY-MONTH-BEFORE-LAST-FRI: Last Friday of the pre-quarter month
 * - QUARTERLY-MONTH-BEFORE-1: First day of the pre-quarter month
 * - QUARTERLY-MONTH-BEFORE-15: 15th day of the pre-quarter month
 * - QUARTERLY-MONTH-BEFORE-LAST: Last day of the pre-quarter month
 *
 * EVERY OTHER DAY:
 * - EVERY-OTHER-DAY-A: Every other day (Day A, epoch: Jan 1, 2024)
 * - EVERY-OTHER-DAY-B: Every other day (Day B, opposite of A)
 *
 * EVERY 2 WEEKS (bi-weekly):
 * - EVERY-2-WEEKS-A-MON: Every other Monday (Week A, from first Monday of year)
 * - EVERY-2-WEEKS-B-MON: Every other Monday (Week B, opposite of A)
 * - EVERY-2-WEEKS-A-TUE, EVERY-2-WEEKS-B-TUE, etc.
 *
 * ALTERNATING (deprecated, use EVERY-2-WEEKS instead):
 * - ALTERNATE-MON: Alias for EVERY-2-WEEKS-A-MON
 * - ALTERNATE-TUE: Alias for EVERY-2-WEEKS-A-TUE
 * - etc.
 */

import PlainDate from '#shared/universal/dates/nbdt/PlainDate/mod.ts'
import { isValidPattern } from '#shared/universal/dates/recurring/patterns.ts'

export class PatternMatcher {
  private readonly pattern: string
  private readonly normalizedPattern: string

  constructor(pattern: string) {
    this.pattern = pattern
    this.normalizedPattern = pattern.toUpperCase()
  }

  /**
   * Check if a given date matches this pattern
   */
  matches(date: PlainDate): boolean {
    // Every other day patterns (must check before EVERY- since it also starts with EVERY-)
    if (this.normalizedPattern.startsWith('EVERY-OTHER-DAY-')) {
      return this.matchesEveryOtherDayPattern(date)
    }

    // Every 2 weeks patterns (must check before EVERY- since it also starts with EVERY-)
    if (this.normalizedPattern.startsWith('EVERY-2-WEEKS-')) {
      return this.matchesEvery2WeeksPattern(date)
    }

    // Daily/Weekly patterns
    if (this.normalizedPattern.startsWith('EVERY-')) {
      return this.matchesEveryPattern(date)
    }

    // Monthly patterns
    if (this.normalizedPattern.startsWith('MONTHLY-')) {
      return this.matchesMonthlyPattern(date)
    }

    // Quarterly-Pre patterns (must check before QUARTERLY- since it also starts with QUARTERLY-)
    if (this.normalizedPattern.startsWith('QUARTERLY-MONTH-BEFORE-')) {
      return this.matchesQuarterlyMonthBeforePattern(date)
    }

    // Quarterly patterns
    if (this.normalizedPattern.startsWith('QUARTERLY-')) {
      return this.matchesQuarterlyPattern(date)
    }

    // Alternating patterns (deprecated, alias for EVERY-2-WEEKS-A)
    if (this.normalizedPattern.startsWith('ALTERNATE-')) {
      return this.matchesAlternatePattern(date)
    }

    // Validate against shared pattern definitions
    if (!isValidPattern(this.normalizedPattern)) {
      console.warn(`Unknown pattern: ${this.pattern}`)
    }
    return false
  }

  private matchesEveryPattern(date: PlainDate): boolean {
    const pattern = this.normalizedPattern.substring('EVERY-'.length)
    const dayOfWeek = date.dayOfWeek // Now 1-7 (Monday=1, Sunday=7)

    switch (pattern) {
      case 'DAY':
        return true
      case 'WEEKDAY':
        return dayOfWeek >= 1 && dayOfWeek <= 5
      case 'WEEKEND':
        return dayOfWeek === 6 || dayOfWeek === 7
      case 'MON':
        return dayOfWeek === 1
      case 'TUE':
        return dayOfWeek === 2
      case 'WED':
        return dayOfWeek === 3
      case 'THU':
        return dayOfWeek === 4
      case 'FRI':
        return dayOfWeek === 5
      case 'SAT':
        return dayOfWeek === 6
      case 'SUN':
        return dayOfWeek === 7
      default:
        return false
    }
  }

  private matchesMonthlyPattern(date: PlainDate): boolean {
    const pattern = this.normalizedPattern.substring('MONTHLY-'.length)

    // Handle MONTHLY-LAST-WEEKEND first (specific case)
    if (pattern === 'LAST-WEEKEND') {
      return this.isLastWeekendOfMonth(date)
    }

    // Handle ordinal day patterns (FIRST-MON, SECOND-TUE, LAST-MON, etc.)
    const ordinalMatch = pattern.match(/^(FIRST|SECOND|THIRD|FOURTH|LAST)-(MON|TUE|WED|THU|FRI|SAT|SUN)$/)
    if (ordinalMatch) {
      return this.matchesOrdinalDayOfMonth(date, ordinalMatch[1], ordinalMatch[2])
    }

    // Handle MONTHLY-LAST-N patterns (where N is a number)
    if (pattern.startsWith('LAST-')) {
      const remainder = pattern.substring('LAST-'.length)
      // Check if remainder is a number
      if (/^\d+$/.test(remainder)) {
        return this.matchesMonthlyLastPattern(date, remainder)
      }
    }

    // Handle MONTHLY-LAST (without number)
    if (pattern === 'LAST') {
      return date.day === date.daysInMonth
    }

    // Handle numeric day patterns (MONTHLY-1, MONTHLY-15, etc.)
    const dayMatch = pattern.match(/^(\d+)$/)
    if (dayMatch) {
      const targetDay = parseInt(dayMatch[1], 10)
      return date.day === targetDay
    }

    return false
  }

  private matchesMonthlyLastPattern(date: PlainDate, offsetStr: string): boolean {
    const offset = parseInt(offsetStr, 10)
    if (isNaN(offset)) return false

    const targetDay = date.daysInMonth - offset
    return date.day === targetDay
  }

  private matchesOrdinalDayOfMonth(date: PlainDate, ordinal: string, dayName: string): boolean {
    const targetDayOfWeek = this.dayNameToNumber(dayName)

    if (date.dayOfWeek !== targetDayOfWeek) return false

    if (ordinal === 'LAST') {
      // Check if this is the last occurrence of this day in the month
      const nextWeek = date.addDays(7)
      return nextWeek.month !== date.month || nextWeek.year !== date.year
    }

    // Calculate which occurrence this is
    const occurrenceNumber = this.getOccurrenceNumber(date)
    const ordinalMap: Record<string, number> = {
      FIRST: 1,
      SECOND: 2,
      THIRD: 3,
      FOURTH: 4,
    }

    return occurrenceNumber === ordinalMap[ordinal]
  }

  private matchesQuarterlyPattern(date: PlainDate): boolean {
    const pattern = this.normalizedPattern.substring('QUARTERLY-'.length)
    const quarter = this.getQuarter(date)
    const quarterStart = this.getQuarterStart(date.year, quarter)
    const quarterEnd = this.getQuarterEnd(date.year, quarter)

    // Handle QUARTERLY-LAST-N patterns
    if (pattern.startsWith('LAST-')) {
      const offsetStr = pattern.substring('LAST-'.length)
      const offset = parseInt(offsetStr, 10)
      if (!isNaN(offset)) {
        const targetDate = quarterEnd.addDays(-offset)
        return date.equals(targetDate)
      }
    }

    // Handle QUARTERLY-LAST
    if (pattern === 'LAST') {
      return date.equals(quarterEnd)
    }

    // Handle ordinal day patterns (FIRST-MON, LAST-FRI, etc.)
    const ordinalMatch = pattern.match(/^(FIRST|LAST)-(MON|TUE|WED|THU|FRI|SAT|SUN)$/)
    if (ordinalMatch) {
      return this.matchesOrdinalDayOfQuarter(date, ordinalMatch[1], ordinalMatch[2], quarterStart, quarterEnd)
    }

    // Handle numeric day patterns (QUARTERLY-1, QUARTERLY-15, etc.)
    const dayMatch = pattern.match(/^(\d+)$/)
    if (dayMatch) {
      const targetDay = parseInt(dayMatch[1], 10)
      const daysSinceQuarterStart = this.daysBetween(quarterStart, date)
      return daysSinceQuarterStart === targetDay - 1
    }

    return false
  }

  /**
   * Pre-quarter months: Dec (before Q1), Mar (before Q2), Jun (before Q3), Sep (before Q4)
   */
  private isPreQuarterMonth(month: number): boolean {
    return month === 12 || month === 3 || month === 6 || month === 9
  }

  private matchesQuarterlyMonthBeforePattern(date: PlainDate): boolean {
    // First check if we're in a pre-quarter month
    if (!this.isPreQuarterMonth(date.month)) {
      return false
    }

    const pattern = this.normalizedPattern.substring('QUARTERLY-MONTH-BEFORE-'.length)

    // Handle QUARTERLY-MONTH-BEFORE-LAST (last day of pre-quarter month)
    if (pattern === 'LAST') {
      return date.day === date.daysInMonth
    }

    // Handle ordinal day patterns (FIRST-MON, SECOND-TUE, THIRD-WED, FOURTH-THU, LAST-FRI, etc.)
    const ordinalMatch = pattern.match(/^(FIRST|SECOND|THIRD|FOURTH|LAST)-(MON|TUE|WED|THU|FRI|SAT|SUN)$/)
    if (ordinalMatch) {
      return this.matchesOrdinalDayOfMonth(date, ordinalMatch[1], ordinalMatch[2])
    }

    // Handle numeric day patterns (QUARTERLY-MONTH-BEFORE-1, QUARTERLY-MONTH-BEFORE-15, etc.)
    const dayMatch = pattern.match(/^(\d+)$/)
    if (dayMatch) {
      const targetDay = parseInt(dayMatch[1], 10)
      return date.day === targetDay
    }

    return false
  }

  private matchesEveryOtherDayPattern(date: PlainDate): boolean {
    // Pattern format: EVERY-OTHER-DAY-A or EVERY-OTHER-DAY-B
    const pattern = this.normalizedPattern.substring('EVERY-OTHER-DAY-'.length)

    if (pattern !== 'A' && pattern !== 'B') return false

    // Epoch: Jan 1, 2024
    const epoch = new PlainDate(2024, 1, 1)
    const daysSinceEpoch = this.daysBetween(epoch, date)

    // Day A = even days (0, 2, 4...), Day B = odd days (1, 3, 5...)
    const isEvenDay = daysSinceEpoch % 2 === 0
    return pattern === 'A' ? isEvenDay : !isEvenDay
  }

  private matchesEvery2WeeksPattern(date: PlainDate): boolean {
    // Pattern format: EVERY-2-WEEKS-A-MON or EVERY-2-WEEKS-B-MON
    const pattern = this.normalizedPattern.substring('EVERY-2-WEEKS-'.length)
    const match = pattern.match(/^([AB])-(MON|TUE|WED|THU|FRI|SAT|SUN)$/)

    if (!match) return false

    const weekType = match[1] // 'A' or 'B'
    const dayName = match[2]
    const targetDayOfWeek = this.dayNameToNumber(dayName)

    if (date.dayOfWeek !== targetDayOfWeek) return false

    const weeksSince = this.getWeeksSinceFirstOccurrence(date, targetDayOfWeek)

    // Week A = even weeks (0, 2, 4...), Week B = odd weeks (1, 3, 5...)
    const isEvenWeek = weeksSince % 2 === 0
    return weekType === 'A' ? isEvenWeek : !isEvenWeek
  }

  private matchesAlternatePattern(date: PlainDate): boolean {
    // Deprecated: ALTERNATE-MON is now an alias for EVERY-2-WEEKS-A-MON
    const pattern = this.normalizedPattern.substring('ALTERNATE-'.length)
    const targetDayOfWeek = this.dayNameToNumber(pattern)

    if (date.dayOfWeek !== targetDayOfWeek) return false

    const weeksSince = this.getWeeksSinceFirstOccurrence(date, targetDayOfWeek)

    // It matches if it's an even number of weeks since the first occurrence (same as Week A)
    return weeksSince % 2 === 0
  }

  private getWeeksSinceFirstOccurrence(date: PlainDate, targetDayOfWeek: number): number {
    // Find the first occurrence of this day in the current year
    let firstOccurrence = new PlainDate(date.year, 1, 1)

    // Find the first occurrence of the target day
    while (firstOccurrence.dayOfWeek !== targetDayOfWeek) {
      firstOccurrence = firstOccurrence.addDays(1)
    }

    // Calculate weeks since first occurrence
    return Math.floor(this.daysBetween(firstOccurrence, date) / 7)
  }

  private isLastWeekendOfMonth(date: PlainDate): boolean {
    const dayOfWeek = date.dayOfWeek
    if (dayOfWeek !== 6 && dayOfWeek !== 7) return false // Not weekend (Saturday=6, Sunday=7)

    const nextWeek = date.addDays(7)
    return nextWeek.month !== date.month || nextWeek.year !== date.year
  }

  private matchesOrdinalDayOfQuarter(
    date: PlainDate,
    ordinal: string,
    dayName: string,
    quarterStart: PlainDate,
    quarterEnd: PlainDate,
  ): boolean {
    const targetDayOfWeek = this.dayNameToNumber(dayName)

    if (date.dayOfWeek !== targetDayOfWeek) return false

    if (ordinal === 'FIRST') {
      // Check if this is the first occurrence in the quarter
      const daysSinceQuarterStart = this.daysBetween(quarterStart, date)
      return daysSinceQuarterStart < 7
    }

    if (ordinal === 'LAST') {
      // Check if this is the last occurrence in the quarter
      const daysUntilQuarterEnd = this.daysBetween(date, quarterEnd)
      return daysUntilQuarterEnd < 7
    }

    return false
  }

  private getOccurrenceNumber(date: PlainDate): number {
    const dayOfWeek = date.dayOfWeek
    let count = 0

    for (let i = 1; i <= date.day; i++) {
      const checkDate = new PlainDate(date.year, date.month, i)
      if (checkDate.dayOfWeek === dayOfWeek) {
        count++
      }
    }

    return count
  }

  private dayNameToNumber(dayName: string): number {
    // Updated to match PlainDate's dayOfWeek (1=Monday, 7=Sunday)
    const dayMap: Record<string, number> = {
      MON: 1,
      TUE: 2,
      WED: 3,
      THU: 4,
      FRI: 5,
      SAT: 6,
      SUN: 7,
    }
    return dayMap[dayName] ?? -1
  }

  private getQuarter(date: PlainDate): number {
    return Math.ceil(date.month / 3)
  }

  private getQuarterStart(year: number, quarter: number): PlainDate {
    const startMonth = (quarter - 1) * 3 + 1
    return new PlainDate(year, startMonth, 1)
  }

  private getQuarterEnd(year: number, quarter: number): PlainDate {
    const endMonth = quarter * 3
    // Get last day of the quarter month
    const tempDate = new PlainDate(year, endMonth, 1)
    return new PlainDate(year, endMonth, tempDate.daysInMonth)
  }

  private daysBetween(from: PlainDate, to: PlainDate): number {
    const fromMs = from.toDate().getTime()
    const toMs = to.toDate().getTime()
    return Math.floor((toMs - fromMs) / (1000 * 60 * 60 * 24))
  }
}

/**
 * Helper function for easy pattern matching
 */
export function matchesPattern(date: PlainDate, pattern: string): boolean {
  const matcher = new PatternMatcher(pattern)
  return matcher.matches(date)
}
