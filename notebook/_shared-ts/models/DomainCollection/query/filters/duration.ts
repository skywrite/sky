/**
 * Duration parsing for time-based filters.
 */

/**
 * Parse a duration string into days.
 *
 * Supported formats:
 * - "7d" - 7 days
 * - "2w" - 2 weeks (14 days)
 * - "3mo" - 3 months (90 days, approximate)
 * - "1y" - 1 year (365 days)
 * - "m" is also accepted for months (legacy, prefer "mo")
 */
export function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)(d|w|mo|m|y)$/)
  if (!match) {
    throw new Error(`Invalid duration format: ${duration}. Expected format like "7d", "2w", "3mo", "1y"`)
  }

  const value = parseInt(match[1], 10)
  const unit = match[2]

  switch (unit) {
    case 'd':
      return value
    case 'w':
      return value * 7
    case 'mo':
    case 'm':
      return value * 30 // approximate
    case 'y':
      return value * 365
    default:
      throw new Error(`Unknown duration unit: ${unit}`)
  }
}
