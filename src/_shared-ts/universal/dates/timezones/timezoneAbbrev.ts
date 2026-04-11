export default function timezoneAbbrev(date = new Date()): string {
  return date.toLocaleDateString('en-US', { timeZoneName: 'short' }).split(' ').at(-1) as string
}
