import { z } from 'zod'
import type { CalendarFields, CalendarTiming } from '#lib/calendarScheduler/types.ts'
import { calendarInterval, PlainDate, PlainDateTime } from '#universal/dates/nbdt/mod.ts'

export const meetingTimingSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  timezone: z.string().trim().min(1).max(100),
  duration: z.number().int().min(5).max(720),
})

export const meetingFieldsSchema = meetingTimingSchema.extend({
  title: z.string().trim().min(1).max(300),
  account: z.email(),
  guests: z.array(z.object({ name: z.string().trim().max(200), email: z.email() })).max(50),
  conference: z.enum(['none', 'zoom']).optional(),
  description: z.string().max(8000),
})

export function meetingInterval(timing: CalendarTiming) {
  meetingTimingSchema.parse(timing)
  new PlainDate(timing.date)
  try {
    return calendarInterval(
      new PlainDateTime({ date: timing.date, time: timing.time }),
      timing.timezone,
      timing.duration,
    )
  } catch {
    throw new Error(
      'This date, time, or timezone is invalid or falls in a daylight-saving clock change. Choose another time.',
    )
  }
}

export function validateMeeting(value: unknown): CalendarFields {
  const fields = meetingFieldsSchema.parse(value)
  meetingInterval(fields)
  fields.account = fields.account.toLowerCase()
  fields.guests = [
    ...new Map(
      fields.guests.map((guest) => [guest.email.toLowerCase(), { ...guest, email: guest.email.toLowerCase() }]),
    ).values(),
  ]
  fields.guests = fields.guests.filter((guest) => guest.email !== fields.account)
  return fields
}
