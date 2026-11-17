import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'

/**
 * A typed `YYYY-MM-DD HH:MM`, written the notebook's way (`9:05` → `09:05`,
 * `25:10` stays past midnight), or null when it is not a date and time on
 * the calendar. The type review's browser check and the command share it.
 */
export function typedWhen(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
  if (!/^\d{4}-\d{2}-\d{2} \d{1,2}:\d{2}$/.test(text)) return null
  try {
    return new PlainDateTime(text).toString()
  } catch {
    return null
  }
}
