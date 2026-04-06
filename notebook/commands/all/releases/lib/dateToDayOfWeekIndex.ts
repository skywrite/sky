import DAYS from './days.ts'

export default function dateToDayOfWeekIndex(date: Date): number {
  // Get day of week (0=Sunday, 1=Monday, ..., 6=Saturday)
  const dayOfWeek = date.getDay()
  // Convert to Monday-based index (0=Monday, 1=Tuesday, ..., 6=Sunday)
  return dayOfWeek === 0 ? 6 : dayOfWeek - 1
}
