import { z } from 'zod'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import type { CalendarRecurrence } from './types.ts'

export const recurrenceSchema = z
  .object({
    frequency: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
    interval: z.number().int().min(1).max(99),
    ends: z.discriminatedUnion('type', [
      z.object({ type: z.literal('never') }).strict(),
      z.object({ type: z.literal('on'), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict(),
      z.object({ type: z.literal('after'), count: z.number().int().min(1).max(730) }).strict(),
    ]),
  })
  .strict()

export function validateRecurrence(date: string, recurrence?: CalendarRecurrence): void {
  if (!recurrence) return
  recurrenceSchema.parse(recurrence)
  if (recurrence.ends.type === 'on') {
    const end = new PlainDate(recurrence.ends.date)
    if (end.ymd < date) throw new Error('The repeat end date must be on or after the first event.')
  }
}

export function recurrenceLabel({ date, recurrence }: { date: string; recurrence?: CalendarRecurrence }): string {
  if (!recurrence) return 'Does not repeat'
  const { frequency, interval, ends } = recurrence
  const unit = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[frequency]
  const cadence =
    interval === 1
      ? { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' }[frequency]
      : `Every ${interval} ${unit}s`
  let anchor = ''
  let day: PlainDate | undefined
  try {
    if (date) day = new PlainDate(date)
  } catch {
    // An unfinished or invalid date remains editable; validation supplies the question.
  }
  if (day) {
    if (frequency === 'weekly') anchor = ` on ${day.dayLong}`
    if (frequency === 'monthly') anchor = ` on day ${Number(date.slice(8, 10))}`
    if (frequency === 'yearly') anchor = ` on ${date.slice(5)}`
  }
  const end =
    ends.type === 'never'
      ? 'No end date'
      : ends.type === 'on'
        ? `Through ${ends.date}`
        : `${ends.count} occurrence${ends.count === 1 ? '' : 's'}`
  return `${cadence}${anchor} · ${end}`
}
