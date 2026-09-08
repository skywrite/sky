import { z } from 'zod'
import { calendarInstant } from '#universal/dates/nbdt/mod.ts'
import type { CalendarEventSnapshot } from './updateTypes.ts'
import { meetingFieldsSchema, meetingInterval } from './validation.ts'

export const eventRefSchema = z
  .object({
    account: z.email().transform((value) => value.toLowerCase()),
    calendarId: z.string().trim().min(1).max(1024),
    eventId: z.string().trim().min(1).max(1024),
  })
  .strict()

export const eventFieldsSchema = meetingFieldsSchema
  .extend({
    guests: z.array(meetingFieldsSchema.shape.guests.element).max(50),
    location: z.string().max(2000),
  })
  .strict()

export function validateEventFields(value: unknown) {
  const fields = eventFieldsSchema.parse(value)
  meetingInterval(fields)
  fields.account = fields.account.toLowerCase()
  fields.guests = [
    ...new Map(
      fields.guests
        .filter((guest) => guest.email.toLowerCase() !== fields.account)
        .map((guest) => [guest.email.toLowerCase(), { ...guest, email: guest.email.toLowerCase() }]),
    ).values(),
  ]
  return fields
}

export function requireEditable(event: CalendarEventSnapshot): void {
  if (event.unsupported.length) throw new Error(event.unsupported.join(' '))
  if (!event.version) throw new Error('Calendar did not return an event version. Reload the event before editing.')
}

/** Metadata edits may retain a past time; a reschedule must choose a future instant. */
export function validateEventUpdate(event: CalendarEventSnapshot, value: unknown, now: string) {
  requireEditable(event)
  const fields = validateEventFields(value)
  if (fields.account !== event.ref.account) throw new Error('Changing the event organizer is not supported.')
  const interval = meetingInterval(fields)
  if (interval.startMilliseconds !== calendarInstant(event.start) && interval.startMilliseconds <= calendarInstant(now))
    throw new Error('Choose a future event time.')
  if (interval.endMilliseconds !== calendarInstant(event.end) && interval.endMilliseconds <= calendarInstant(now))
    throw new Error('Choose a future event end time.')
  if (JSON.stringify(fields) === JSON.stringify(validateEventFields(event.fields)))
    throw new Error('No event changes were requested.')
  return fields
}
