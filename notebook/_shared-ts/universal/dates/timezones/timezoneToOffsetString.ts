import timezoneToUTCOffsetInHours from './timezoneToUTCOffsetInHours.ts'

/**
 * Format a timezone's UTC offset as a string like "+08:00" or "-05:00"
 *
 * @param timezone - IANA timezone identifier (e.g., 'America/Los_Angeles', 'Asia/Hong_Kong')
 * @param date - Date to calculate offset for (defaults to current date)
 * @returns Formatted offset string (e.g., "-08:00", "+05:30")
 *
 * Examples:
 * - 'America/Los_Angeles' returns "-08:00" (PST) or "-07:00" (PDT)
 * - 'Asia/Kolkata' returns "+05:30"
 * - 'UTC' returns "+00:00"
 */
export default function timezoneToOffsetString(timezone: string, date: Date = new Date()): string {
  const hours = timezoneToUTCOffsetInHours(timezone, date)
  const absHours = Math.abs(hours)
  const wholeHours = Math.floor(absHours)
  const minutes = Math.round((absHours - wholeHours) * 60)
  const sign = hours >= 0 ? '+' : '-'
  return `${sign}${String(wholeHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}
