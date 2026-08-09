import type { GoogleClient } from './client.ts'
import type { StoredTokens } from './tokens.ts'

export const CALENDAR_API_URL = 'https://www.googleapis.com/calendar/v3'
export const CALENDAR_READONLY_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly'

/** Grants stored before the calendar scope was added lack it; callers should say: re-run sky google:auth. */
export function hasCalendarScope(tokens: StoredTokens): boolean {
  return tokens.scopes.includes(CALENDAR_READONLY_SCOPE)
}

export interface CalendarAttendee {
  email: string
  name?: string
  self: boolean
  response: 'accepted' | 'declined' | 'tentative' | 'needsAction'
}

export interface CalendarEvent {
  id: string
  /** Provider-independent identity; survives the same event syncing into other calendars. */
  iCalUid?: string
  /** Email of the account whose calendar produced the event. */
  account: string
  title: string
  /** RFC 3339 with offset for timed events; YYYY-MM-DD when allDay. */
  start: string
  end: string
  allDay: boolean
  /** Humans only — room/resource entries are dropped at normalization. */
  attendees: CalendarAttendee[]
  /** This account's own RSVP, when it appears in the attendee list. */
  selfResponse?: CalendarAttendee['response']
  /** 'default' | 'focusTime' | 'outOfOffice' | 'workingLocation' | 'birthday' | 'fromGmail' */
  eventType: string
  /** 'confirmed' | 'tentative' | 'cancelled' */
  status: string
  conferenceUrl?: string
  location?: string
  htmlLink?: string
}

interface EventTimeWire {
  date?: string
  dateTime?: string
}

interface AttendeeWire {
  email?: string
  displayName?: string
  self?: boolean
  resource?: boolean
  responseStatus?: string
}

interface EventWire {
  id?: string
  iCalUID?: string
  status?: string
  summary?: string
  location?: string
  start?: EventTimeWire
  end?: EventTimeWire
  attendees?: AttendeeWire[]
  eventType?: string
  hangoutLink?: string
  conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> }
  htmlLink?: string
}

interface EventsPageWire {
  items?: EventWire[]
  nextPageToken?: string
}

function normalizeResponse(value?: string): CalendarAttendee['response'] {
  switch (value) {
    case 'accepted':
    case 'declined':
    case 'tentative':
      return value
    default:
      return 'needsAction'
  }
}

function normalizeEvent(wire: EventWire, account: string): CalendarEvent | null {
  const start = wire.start?.dateTime ?? wire.start?.date
  const end = wire.end?.dateTime ?? wire.end?.date
  if (!wire.id || !start || !end) return null
  const attendees: CalendarAttendee[] = (wire.attendees ?? []).flatMap((a) =>
    !a.email || a.resource
      ? []
      : [{ email: a.email, name: a.displayName, self: a.self === true, response: normalizeResponse(a.responseStatus) }],
  )
  const video = wire.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video' && e.uri)
  return {
    id: wire.id,
    iCalUid: wire.iCalUID,
    account,
    title: wire.summary ?? '',
    start,
    end,
    allDay: !wire.start?.dateTime,
    attendees,
    selfResponse: attendees.find((a) => a.self)?.response,
    eventType: wire.eventType ?? 'default',
    status: wire.status ?? 'confirmed',
    conferenceUrl: video?.uri ?? wire.hangoutLink,
    location: wire.location,
    htmlLink: wire.htmlLink,
  }
}

/**
 * Expanded event instances (recurrence unrolled) overlapping [timeMin, timeMax),
 * oldest first. Bounds are RFC 3339 timestamps with offset. When timeZone (an
 * IANA name) is given, response times come back rendered in that zone — letting
 * callers do civil-date filtering with string ops while timezone correctness
 * stays Google's job. This module stays free of notebook time concepts.
 */
export async function listEvents(
  client: GoogleClient,
  options: { timeMin: string; timeMax: string; calendarId?: string; timeZone?: string },
): Promise<CalendarEvent[]> {
  const calendarId = options.calendarId ?? 'primary'
  const events: CalendarEvent[] = []
  let pageToken: string | undefined
  do {
    const url = new URL(`${CALENDAR_API_URL}/calendars/${encodeURIComponent(calendarId)}/events`)
    url.searchParams.set('singleEvents', 'true')
    url.searchParams.set('orderBy', 'startTime')
    url.searchParams.set('timeMin', options.timeMin)
    url.searchParams.set('timeMax', options.timeMax)
    url.searchParams.set('maxResults', '250')
    if (options.timeZone) url.searchParams.set('timeZone', options.timeZone)
    if (pageToken) url.searchParams.set('pageToken', pageToken)
    const page = await client.getJson<EventsPageWire>(url.toString())
    for (const wire of page.items ?? []) {
      const event = normalizeEvent(wire, client.email)
      if (event) events.push(event)
    }
    pageToken = page.nextPageToken
  } while (pageToken)
  return events
}

/**
 * Why an event doesn't count as a meeting the notebook should have a record
 * of, or null to keep it. This is the policy behind day:end's missed-meeting
 * gate: blocks of time knowingly spent with other people (or on a call).
 */
export function meetingDropReason(event: CalendarEvent): string | null {
  if (event.status === 'cancelled') return 'cancelled'
  if (event.allDay) return 'all-day'
  if (event.eventType !== 'default') return `type:${event.eventType}`
  if (event.selfResponse === 'declined') return 'declined'
  if (!event.attendees.some((a) => !a.self) && !event.conferenceUrl) return 'no-other-attendees'
  return null
}
