export default function timezoneOffset(date = new Date()): number {
  return -(date.getTimezoneOffset() / 60)
}
