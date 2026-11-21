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
 *
 * A zone sitting on Greenwich time always reads "GMT+0", the same offset form
 * as "GMT+1" or "GMT+8". System time zone data disagrees on it: Linux says
 * "GMT" for Europe/London and Europe/Dublin in winter, macOS 27.2 says "GMT+0".
 */
export default function timezoneToAbbreviation(timezone: string, date: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'short',
  })
  const parts = formatter.formatToParts(date)
  const name = parts.find((part) => part.type === 'timeZoneName')?.value || ''
  return /^GMT([+-]0{1,2}(:00)?)?$/.test(name) ? 'GMT+0' : name
}
