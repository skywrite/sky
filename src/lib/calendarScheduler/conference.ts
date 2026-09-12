import type { CalendarFields } from './types.ts'

export function calendarConference(fields: Pick<CalendarFields, 'conference' | 'guests'>): 'none' | 'zoom' {
  return fields.conference ?? (fields.guests.length ? 'zoom' : 'none')
}
