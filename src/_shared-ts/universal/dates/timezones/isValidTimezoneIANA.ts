/**
 * Check whether a string is a timezone identifier the runtime accepts,
 * e.g. 'America/Chicago'.
 */
export default function isValidTimezoneIANA(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
    return true
  } catch {
    return false
  }
}
