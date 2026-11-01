import { deprecated, isValidPattern, patterns } from './patterns.ts'

export const RECURRING_DAYS = [
  ['MON', 'Monday'],
  ['TUE', 'Tuesday'],
  ['WED', 'Wednesday'],
  ['THU', 'Thursday'],
  ['FRI', 'Friday'],
  ['SAT', 'Saturday'],
  ['SUN', 'Sunday'],
] as const

/** Keep the extractor's case-sensitive legacy vocabulary compatible. */
export function canonicalRecurringPattern(value: string): string | null {
  const legacy: Record<string, string> = {
    'EVERY DAY': 'EVERY-DAY',
    WEEKDAYS: 'EVERY-WEEKDAY',
    WEEKEND: 'EVERY-WEEKEND',
    ...Object.fromEntries(RECURRING_DAYS.map(([code, name]) => [name, 'EVERY-' + code])),
  }
  const normalized = Object.hasOwn(legacy, value) ? legacy[value] : value.toUpperCase()
  const current = deprecated.find((pattern) => pattern.pattern === normalized)?.replacement ?? normalized
  return isValidPattern(current) ? current : null
}

export function recurringPatternLabel(value: string): string {
  const pattern = canonicalRecurringPattern(value)
  if (!pattern) return value
  const entry = patterns.find((entry) => entry.pattern === pattern)
  if (entry) return entry.description.replace(/ \(.*\)$/, '')
  let match = /^MONTHLY-(\d+)$/.exec(pattern)
  if (match) return 'Day ' + Number(match[1]) + ' of each month'
  match = /^MONTHLY-LAST-(\d+)$/.exec(pattern)
  if (match) return Number(match[1]) + ' days before month end'
  match = /^QUARTERLY-(\d+)$/.exec(pattern)
  if (match) return 'Day ' + Number(match[1]) + ' of each quarter'
  match = /^QUARTERLY-LAST-(\d+)$/.exec(pattern)
  if (match) return Number(match[1]) + ' days before quarter end'
  match = /^QUARTERLY-MONTH-BEFORE-(\d+)$/.exec(pattern)
  return match ? 'Day ' + Number(match[1]) + ' of the month before each quarter' : pattern
}
