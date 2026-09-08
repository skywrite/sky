import { CALENDAR_API_URL, getEvent, listEvents, type CalendarEvent } from '#lib/google/calendar.ts'
import type { GoogleClient } from '#lib/google/client.ts'
import { updateCalendarEvent } from '#lib/google/updateCalendarEvent.ts'
import { calendarInstant, calendarLocal, PlainDate } from '#universal/dates/nbdt/mod.ts'
import { locateCalendarEvent, parseCalendarUpdate } from './parseUpdate.ts'
import type { CalendarSchedulerHost } from './types.ts'
import type { CalendarEventSnapshot, CalendarUpdateHost } from './updateTypes.ts'

interface CalendarInfo {
  id: string
  summary: string
  timeZone: string
}

export function calendarEventSnapshot(event: CalendarEvent, calendar: CalendarInfo): CalendarEventSnapshot {
  const timezone = event.timezone ?? calendar.timeZone
  const local = event.allDay ? { date: event.start, time: '00:00' } : calendarLocal(event.start, timezone)
  const unsupported: string[] = []
  if (event.allDay)
    unsupported.push('All-day events cannot be edited by the scheduler yet. Open this event in Google Calendar.')
  if (event.eventType !== 'default')
    unsupported.push(`This ${event.eventType} event must be edited in Google Calendar.`)
  if (event.recurrence?.length) unsupported.push('Select a single occurrence, not the recurring series.')
  if (!event.organizer?.self && event.organizer?.email?.toLowerCase() !== calendar.id.toLowerCase())
    unsupported.push('Only the organizer’s event can be updated. Ask its organizer to make the change.')
  if (event.attendeesOmitted)
    unsupported.push('Calendar returned an incomplete guest list. Open the event in Google Calendar.')
  if (!event.etag) unsupported.push('Calendar did not return a version for this event. Reload it before editing.')
  return {
    ref: { account: event.account, calendarId: calendar.id, eventId: event.id },
    version: event.etag ?? '',
    fields: {
      account: event.account,
      title: event.title,
      date: local.date,
      time: local.time,
      timezone,
      duration: event.allDay ? 1440 : (calendarInstant(event.end) - calendarInstant(event.start)) / 60_000,
      description: event.description ?? '',
      location: event.location ?? '',
      guests: event.attendees
        .filter((guest) => !guest.self && guest.email.toLowerCase() !== event.organizer?.email?.toLowerCase())
        .map((guest) => ({ name: guest.name ?? '', email: guest.email.toLowerCase() })),
    },
    start: event.start,
    end: event.end,
    iCalUid: event.iCalUid,
    calendarName: calendar.summary,
    calendarUrl: event.htmlLink ?? '',
    conferenceUrl: event.conferenceUrl,
    recurring: !!event.recurringEventId,
    resourceEmails: event.resourceEmails ?? [],
    unsupported,
  }
}

export function createGoogleCalendarUpdates(
  clientFor: (account: string) => Promise<GoogleClient>,
  people: CalendarSchedulerHost['people'],
): CalendarUpdateHost {
  const read: CalendarUpdateHost['read'] = async (ref) => {
    const client = await clientFor(ref.account)
    const calendar = await client.getJson<CalendarInfo>(
      `${CALENDAR_API_URL}/calendars/${encodeURIComponent(ref.calendarId)}`,
    )
    return calendarEventSnapshot(await getEvent(client, calendar.id, ref.eventId), calendar)
  }
  return {
    locate: locateCalendarEvent,
    find: async (search, accounts) => {
      const events: CalendarEventSnapshot[] = []
      const warnings: string[] = []
      await Promise.all(
        accounts.map(async (account) => {
          try {
            const client = await clientFor(account)
            let token: string | undefined
            do {
              const url = new URL(`${CALENDAR_API_URL}/users/me/calendarList`)
              url.searchParams.set('minAccessRole', 'owner')
              url.searchParams.set('maxResults', '250')
              if (token) url.searchParams.set('pageToken', token)
              const page = await client.getJson<{ items?: CalendarInfo[]; nextPageToken?: string }>(url.toString())
              for (const calendar of page.items ?? []) {
                try {
                  const found = await listEvents(client, {
                    calendarId: calendar.id,
                    timeMin: `${new PlainDate(search.from).addDays(-1).ymd}T00:00:00Z`,
                    timeMax: `${new PlainDate(search.to).addDays(1).ymd}T00:00:00Z`,
                    timeZone: search.timezone,
                    query: search.query,
                  })
                  for (const event of found) {
                    const date = event.allDay ? event.start : calendarLocal(event.start, search.timezone).date
                    if (event.status !== 'cancelled' && date >= search.from && date < search.to)
                      events.push(calendarEventSnapshot(event, calendar))
                  }
                } catch {
                  warnings.push(`Could not search ${calendar.summary} · ${account}.`)
                }
              }
              token = page.nextPageToken
            } while (token)
          } catch {
            warnings.push(`Could not search calendars for ${account}.`)
          }
        }),
      )
      events.sort((a, b) => a.start.localeCompare(b.start) || a.fields.title.localeCompare(b.fields.title))
      if (events.length > 100) warnings.push('Showing the first 100 matches. Narrow the current event title or date.')
      return { events: events.slice(0, 100), warnings: warnings.sort() }
    },
    read,
    parse: (request, event, timezone, signal) => parseCalendarUpdate(request, event, timezone, people, signal),
    save: (event, fields, hooks) => updateCalendarEvent(event, fields, hooks, () => read(event.ref)),
  }
}
