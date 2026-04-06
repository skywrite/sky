/**
 * Get the timezone abbreviation for a given IANA timezone at a specific date
 *
 * @param timezone - IANA timezone identifier (e.g., 'America/Los_Angeles', 'Asia/Hong_Kong')
 * @param date - Date to get abbreviation for (defaults to current date)
 * @returns Timezone abbreviation (e.g., "PST", "EDT", "HKT")
 *
 * Examples:
 * - 'America/Chicago' in winter returns "CST"
 * - 'America/Chicago' in summer returns "CDT"
 * - 'Asia/Hong_Kong' returns "HKT"
 * - 'UTC' returns "UTC"
 *
 * Note: The exact abbreviation format may vary by JavaScript environment.
 * Some environments may return "GMT+1" instead of "BST" for example.
 */
export default function timezoneToAbbreviation(timezone: string, date: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'short',
  })
  const parts = formatter.formatToParts(date)
  const timeZonePart = parts.find((part) => part.type === 'timeZoneName')
  return timeZonePart?.value || ''
}
