import { TestSecretsProvider } from '#lib/secrets/TestSecretsProvider.ts'
import { assert, test } from '#test'
import { CALENDAR_READONLY_SCOPE, hasCalendarScope, listEvents, meetingDropReason } from './calendar.ts'
import type { CalendarEvent } from './calendar.ts'
import { GoogleClient } from './client.ts'
import { saveAccountTokens } from './tokens.ts'

test('listEvents', async () => {
  const secrets = new TestSecretsProvider()
  await saveAccountTokens(secrets, 'jane@example.com', { refreshToken: 'rt', accessToken: 'at', scopes: [] })

  const pages = [
    {
      items: [
        {
          id: 'ev1',
          iCalUID: 'uid1@google.com',
          status: 'confirmed',
          summary: 'Atlas sync',
          start: { dateTime: '2026-01-05T10:00:00-08:00' },
          end: { dateTime: '2026-01-05T10:30:00-08:00' },
          attendees: [
            { email: 'jane@example.com', self: true, responseStatus: 'accepted' },
            { email: 'sam@example.com', displayName: 'Sam Roe', responseStatus: 'tentative' },
            { email: 'room-4@resource.calendar.google.com', resource: true, responseStatus: 'accepted' },
          ],
          conferenceData: {
            entryPoints: [
              { entryPointType: 'phone', uri: 'tel:+15550100' },
              { entryPointType: 'video', uri: 'https://meet.example.com/abc' },
            ],
          },
        },
        { summary: 'ghost without id or times' },
      ],
      nextPageToken: 'p2',
    },
    {
      items: [{ id: 'ev2', summary: 'Conference day', start: { date: '2026-01-05' }, end: { date: '2026-01-06' } }],
    },
  ]
  const urls: string[] = []
  const fetchFn = (async (url: unknown) => {
    urls.push(String(url))
    return new Response(JSON.stringify(pages[urls.length - 1]), { status: 200 })
  }) as typeof fetch
  const client = new GoogleClient({
    secrets,
    email: 'jane@example.com',
    client: { clientId: 'id', clientSecret: 'sec' },
    fetchFn,
    sleep: async () => {},
  })

  const events = await listEvents(client, {
    timeMin: '2026-01-05T04:00:00-08:00',
    timeMax: '2026-01-06T04:00:00-08:00',
    timeZone: 'America/Chicago',
  })

  const first = new URL(urls[0])
  assert({
    given: 'a day window and a response zone',
    should: 'query primary with recurrence expanded, time-ordered, bounds and zone passed through',
    expected: [
      '/calendar/v3/calendars/primary/events',
      'true',
      'startTime',
      '2026-01-05T04:00:00-08:00',
      'America/Chicago',
      null,
    ],
    actual: [
      first.pathname,
      first.searchParams.get('singleEvents'),
      first.searchParams.get('orderBy'),
      first.searchParams.get('timeMin'),
      first.searchParams.get('timeZone'),
      first.searchParams.get('pageToken'),
    ],
  })

  assert({
    given: 'a nextPageToken on the first page',
    should: 'follow it and concatenate pages, skipping items without id or times',
    expected: [2, 'p2', ['ev1', 'ev2']],
    actual: [urls.length, new URL(urls[1]).searchParams.get('pageToken'), events.map((e) => e.id)],
  })

  assert({
    given: 'a timed event with a room, a self attendee, and conference entry points',
    should: 'keep humans only, detect own RSVP, and pick the video entry point',
    expected: {
      account: 'jane@example.com',
      attendees: ['jane@example.com', 'sam@example.com'],
      selfResponse: 'accepted',
      conferenceUrl: 'https://meet.example.com/abc',
      allDay: false,
      iCalUid: 'uid1@google.com',
    },
    actual: {
      account: events[0].account,
      attendees: events[0].attendees.map((a) => a.email),
      selfResponse: events[0].selfResponse,
      conferenceUrl: events[0].conferenceUrl,
      allDay: events[0].allDay,
      iCalUid: events[0].iCalUid,
    },
  })

  assert({
    given: 'a date-only event',
    should: 'flag it all-day and carry the plain dates',
    expected: { allDay: true, start: '2026-01-05', end: '2026-01-06', selfResponse: undefined },
    actual: {
      allDay: events[1].allDay,
      start: events[1].start,
      end: events[1].end,
      selfResponse: events[1].selfResponse,
    },
  })
})

function event(overrides: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 'e1',
    account: 'jane@example.com',
    title: 'Atlas sync',
    start: '2026-01-05T10:00:00-08:00',
    end: '2026-01-05T10:30:00-08:00',
    allDay: false,
    attendees: [
      { email: 'jane@example.com', self: true, response: 'accepted' },
      { email: 'sam@example.com', self: false, response: 'accepted' },
    ],
    selfResponse: 'accepted',
    eventType: 'default',
    status: 'confirmed',
    ...overrides,
  }
}

test('meetingDropReason', () => {
  assert({
    given: 'a confirmed timed event with another attendee',
    should: 'keep it',
    expected: null,
    actual: meetingDropReason(event({})),
  })

  assert({
    given: 'events outside the meeting policy',
    should: 'name the drop reason',
    expected: ['cancelled', 'all-day', 'type:focusTime', 'declined', 'no-other-attendees'],
    actual: [
      meetingDropReason(event({ status: 'cancelled' })),
      meetingDropReason(event({ allDay: true })),
      meetingDropReason(event({ eventType: 'focusTime' })),
      meetingDropReason(event({ selfResponse: 'declined' })),
      meetingDropReason(event({ attendees: [{ email: 'jane@example.com', self: true, response: 'accepted' }] })),
    ],
  })

  assert({
    given: 'a solo event that still has a conference link',
    should: 'keep it — a call can have no listed attendees',
    expected: null,
    actual: meetingDropReason(
      event({
        attendees: [{ email: 'jane@example.com', self: true, response: 'accepted' }],
        conferenceUrl: 'https://meet.example.com/abc',
      }),
    ),
  })
})

test('hasCalendarScope', () => {
  assert({
    given: 'tokens granted before and after the calendar scope was added',
    should: 'detect only the grant that includes it',
    expected: [false, true],
    actual: [
      hasCalendarScope({ refreshToken: 'rt', scopes: ['https://www.googleapis.com/auth/drive'] }),
      hasCalendarScope({ refreshToken: 'rt', scopes: [CALENDAR_READONLY_SCOPE] }),
    ],
  })
})
