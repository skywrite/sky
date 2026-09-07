import { createHash } from 'node:crypto'
import type { CalendarEvent } from '#lib/google/calendar.ts'
import { calendarInstant, calendarInterval, instantNow, PlainDate, PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import type { MeetingAvailability, MeetingDayEvent, MeetingTiming } from './types.ts'
import { meetingInterval } from './validation.ts'

export interface CalendarSourceEvents {
  label: string
  events: CalendarEvent[]
}

/** Overlap is half-open: one meeting can start exactly when another ends. */
export function availabilityOf(
  timing: MeetingTiming,
  sources: CalendarSourceEvents[],
  warnings: string[],
  now: string = instantNow(),
): MeetingAvailability {
  const requested = meetingInterval(timing)
  const day = new PlainDate(timing.date)
  const midnight = (date: string) =>
    calendarInterval(new PlainDateTime({ date, time: '00:00' }), timing.timezone, 1).startMilliseconds
  const dayStart = midnight(day.ymd)
  const dayEnd = midnight(day.addDays(1).ymd)
  const byId = new Map<string, { row: MeetingDayEvent; from: number; to: number }>()
  for (const source of sources) {
    for (const event of source.events) {
      if (event.status === 'cancelled' || event.selfResponse === 'declined') continue
      const from = event.allDay ? midnight(event.start) : calendarInstant(event.start)
      const to = event.allDay ? midnight(event.end) : calendarInstant(event.end)
      if (to <= dayStart || from >= Math.max(dayEnd, requested.endMilliseconds)) continue
      const busy =
        event.transparency !== 'transparent' && event.eventType !== 'workingLocation' && event.eventType !== 'birthday'
      const conflict = busy && from < requested.endMilliseconds && to > requested.startMilliseconds
      const id = `${event.iCalUid ?? event.id}/${event.start}`
      const previous = byId.get(id)
      if (previous) {
        previous.row.busy ||= busy
        previous.row.conflict ||= conflict
        continue
      }
      byId.set(id, {
        row: {
          id,
          title: event.title || 'Busy',
          start: event.start,
          end: event.end,
          allDay: event.allDay,
          calendar: source.label,
          busy,
          conflict,
          url: event.htmlLink,
        },
        from,
        to,
      })
    }
  }
  const entries = [...byId.values()].sort((a, b) => a.from - b.from || a.row.title.localeCompare(b.row.title))
  const alternatives: Array<{ time: string; distance: number }> = []
  if (entries.some((entry) => entry.row.conflict) && !warnings.length) {
    for (let minute = 8 * 60; minute + timing.duration <= 19 * 60; minute += 15) {
      const time = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
      let slot: ReturnType<typeof meetingInterval>
      try {
        slot = meetingInterval({ ...timing, time })
      } catch {
        continue
      }
      if (slot.startMilliseconds <= calendarInstant(now)) continue
      if (
        entries.some(
          (entry) => entry.row.busy && entry.from < slot.endMilliseconds && entry.to > slot.startMilliseconds,
        )
      )
        continue
      alternatives.push({ time, distance: Math.abs(slot.startMilliseconds - requested.startMilliseconds) })
    }
  }
  const events = entries.map((entry) => entry.row)
  const reviewKey = createHash('sha256')
    .update(
      JSON.stringify({
        timing: { date: timing.date, time: timing.time, timezone: timing.timezone, duration: timing.duration },
        conflicts: events
          .filter((event) => event.conflict)
          .map(({ id, title, start, end }) => ({ id, title, start, end })),
        warnings: [...warnings].sort(),
      }),
    )
    .digest('hex')
  return {
    date: timing.date,
    timezone: timing.timezone,
    events,
    warnings,
    calendars: sources.map((source) => source.label),
    alternatives: alternatives
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 3)
      .map((slot) => slot.time),
    reviewKey,
  }
}
