/**
 * Calculate the UTC offset for a given IANA timezone at a specific date/time
 *
 * @param timezone - IANA timezone identifier (e.g., 'America/Los_Angeles', 'Asia/Hong_Kong')
 * @param date - Date to calculate offset for (defaults to current date)
 * @returns Offset from UTC in hours (negative for west of UTC, positive for east)
 *
 * Examples:
 * - 'America/Los_Angeles' returns -8 (PST) or -7 (PDT)
 * - 'America/New_York' returns -5 (EST) or -4 (EDT)
 * - 'UTC' returns 0
 * - 'Asia/Hong_Kong' returns 8
 * - 'Asia/Tokyo' returns 9
 */
export default function timezoneToUTCOffsetInHours(timezone: string, date: Date = new Date()): number {
  // Use Intl.DateTimeFormat to get the local time in the target timezone
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

  // Extract the date/time parts in the target timezone
  const parts = dtf.formatToParts(date)
  const values: Record<string, string> = {}
  for (const p of parts) {
    if (p.type !== 'literal') {
      values[p.type] = p.value
    }
  }

  // Reconstruct what the "local time" would be in that timezone as UTC
  // This gives us the timestamp if that local time were actually UTC
  const localAsUTC = Date.UTC(
    parseInt(values.year),
    parseInt(values.month) - 1, // JavaScript months are 0-based
    parseInt(values.day),
    parseInt(values.hour),
    parseInt(values.minute),
    parseInt(values.second),
  )

  // Calculate offset:
  // localAsUTC represents what UTC timestamp would show the same clock time
  // If timezone is behind UTC (e.g., LA), local clock shows earlier time
  // If timezone is ahead of UTC (e.g., Tokyo), local clock shows later time
  const offsetMs = localAsUTC - date.getTime()

  // Convert from milliseconds to hours
  // Negative offset means west of UTC (behind)
  // Positive offset means east of UTC (ahead)
  const offsetHours = offsetMs / (1000 * 60 * 60)

  // Round to nearest quarter hour to handle any precision issues
  // Most timezones are on hour or half-hour boundaries anyway
  const rounded = Math.round(offsetHours * 4) / 4

  // Normalize -0 to 0 for consistent comparison in tests
  return rounded === 0 ? 0 : rounded
}
