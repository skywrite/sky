export default function isValid(date: unknown): boolean {
  if (!(date instanceof Date)) return false
  return !Number.isNaN(date.getTime())
}
