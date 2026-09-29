import type { CalendarRecurrence } from '#lib/calendarScheduler/types.ts'
import { calendarLocal, PlainDate } from '#universal/dates/nbdt/mod.ts'
import type { CalendarEvent } from './calendar.ts'

export interface RecurringTiming {
  date: string
  time: string
  timezone: string
  recurrence?: CalendarRecurrence
}

/** An expanded occurrence cannot prove the series rule. Verify the parent returned by events.get. */
export function calendarRecurrenceMatches(event: CalendarEvent, timing: RecurringTiming): boolean {
  const expected = timing.recurrence
  if (!expected) return !event.recurringEventId && !event.recurrence?.length
  if (event.recurringEventId || event.recurrence?.length !== 1 || event.timezone !== timing.timezone) return false
  const line = event.recurrence[0]!
  if (!line.startsWith('RRULE:')) return false
  const entries = line
    .slice(6)
    .split(';')
    .map((part) => part.split('='))
  if (entries.some((part) => part.length !== 2) || new Set(entries.map(([key]) => key)).size !== entries.length)
    return false
  const rule = Object.fromEntries(entries) as Record<string, string>
  if (rule.FREQ !== expected.frequency.toUpperCase() || Number(rule.INTERVAL ?? 1) !== expected.interval) return false
  const allowed = new Set(['FREQ', 'INTERVAL', 'WKST', 'COUNT', 'UNTIL'])
  if (rule.WKST && !['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'].includes(rule.WKST)) return false
  if (expected.frequency === 'weekly') {
    allowed.add('BYDAY')
    if (rule.BYDAY && rule.BYDAY !== new PlainDate(timing.date).dayLong.slice(0, 2).toUpperCase()) return false
  }
  if (expected.frequency === 'monthly' || expected.frequency === 'yearly') {
    allowed.add('BYMONTHDAY')
    if (rule.BYMONTHDAY && rule.BYMONTHDAY !== String(Number(timing.date.slice(8)))) return false
  }
  if (expected.frequency === 'yearly') {
    allowed.add('BYMONTH')
    if (rule.BYMONTH && rule.BYMONTH !== String(Number(timing.date.slice(5, 7)))) return false
  }
  if (Object.keys(rule).some((key) => !allowed.has(key))) return false
  const ends = expected.ends
  if (ends.type === 'never') return !rule.COUNT && !rule.UNTIL
  if (ends.type === 'after') return !rule.UNTIL && rule.COUNT === String(ends.count)
  if (rule.COUNT || !rule.UNTIL) return false
  const until = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(rule.UNTIL)
  if (!until) return false
  try {
    const local = calendarLocal(
      `${until[1]}-${until[2]}-${until[3]}T${until[4]}:${until[5]}:${until[6]}Z`,
      timing.timezone,
    )
    return local.date === ends.date && local.time >= timing.time
  } catch {
    return false
  }
}

const months = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

/** Check the editor's selected repeat summary before creating a conference or saving. */
export function calendarRepeatSummaryMatches(summary: string, timing: RecurringTiming): boolean {
  const text = summary.replaceAll(/\s+/g, ' ').trim()
  const repeat = timing.recurrence
  if (!repeat) return text === 'Does not repeat'
  const { frequency, interval, ends } = repeat
  const unit = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[frequency]
  const single = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', yearly: '(?:Annually|Yearly)' }[frequency]
  const cadence = interval === 1 ? `(?:${single}|Every ${unit}|Every 1 ${unit})` : `Every ${interval} ${unit}s`
  const datePart = (date: string, year: boolean) => {
    const month = months[Number(date.slice(5, 7)) - 1]!
    return `${month.slice(0, 3)}(?:${month.slice(3)})? ${Number(date.slice(8))}${year ? `,? ${date.slice(0, 4)}` : ''}`
  }
  const anchor =
    frequency === 'weekly'
      ? ` on ${new PlainDate(timing.date).dayLong}`
      : frequency === 'monthly'
        ? ` on (?:day )?${Number(timing.date.slice(8))}`
        : frequency === 'yearly'
          ? ` on ${datePart(timing.date, false)}`
          : ''
  const end =
    ends.type === 'never'
      ? ''
      : ends.type === 'after'
        ? `, ${ends.count} times?`
        : `, until ${datePart(ends.date, true)}`
  return new RegExp(`^${cadence}${anchor}${end}$`, 'i').test(text)
}
