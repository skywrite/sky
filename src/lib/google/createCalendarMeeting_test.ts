import type { Page } from 'playwright'
import type { CalendarEvent } from '#lib/google/calendar.ts'
import {
  type CalendarMeeting,
  finishCalendarInvitation,
  savedMeetingMatches,
  zoomMeetingUrl,
} from '#lib/google/createCalendarMeeting.ts'
import { assert, test } from '#test'

const URL = 'https://zoom.us/j/12345678901?pwd=example'
const MEETING: CalendarMeeting = {
  title: 'Atlas review',
  description: '',
  account: 'organizer@example.com',
  calendarId: 'organizer@example.com',
  calendarName: 'Work',
  date: '2030-05-03',
  time: '15:00',
  timezone: 'America/New_York',
  start: '2030-05-03T15:00:00-04:00',
  end: '2030-05-03T15:30:00-04:00',
  endDate: '2030-05-03',
  endTime: '15:30',
  guests: [{ name: 'Jane Doe', email: 'jane@example.com' }],
}
const EVENT: CalendarEvent = {
  id: 'mock-event',
  account: MEETING.account,
  title: MEETING.title,
  start: '2030-05-03T19:00:00Z',
  end: '2030-05-03T19:30:00Z',
  allDay: false,
  attendees: [
    { email: 'organizer@example.com', self: true, response: 'accepted' },
    { email: 'jane@example.com', self: false, response: 'needsAction' },
  ],
  eventType: 'default',
  status: 'confirmed',
  conferenceUrl: URL,
}

test('Calendar Zoom readback must match the exact guests, instant and Zoom conference', () => {
  assert({
    given: 'a verified event or a differing guest, offset, or conference',
    should: 'report success only for the reviewed invitation',
    actual: [
      savedMeetingMatches(EVENT, MEETING, URL),
      savedMeetingMatches(
        {
          ...EVENT,
          attendees: [...EVENT.attendees, { email: 'extra@example.com', self: false, response: 'needsAction' }],
        },
        MEETING,
        URL,
      ),
      savedMeetingMatches({ ...EVENT, start: '2030-05-03T15:00:00-05:00' }, MEETING, URL),
      savedMeetingMatches({ ...EVENT, conferenceUrl: 'https://zoom.us/j/10987654321' }, MEETING, URL),
    ],
    expected: [true, false, false, false],
  })
})

test('Zoom links unwrap Google redirects but reject non-Zoom and host-control URLs', () => {
  const wrapped = `https://www.google.com/url?q=${encodeURIComponent(URL)}&source=calendar`
  assert({
    given: 'a Google redirect and untrusted or non-joining addresses',
    should: 'retain only HTTPS Zoom join links',
    actual: [
      zoomMeetingUrl(wrapped),
      zoomMeetingUrl('https://zoom.us.example.com/j/12345678901'),
      zoomMeetingUrl('https://zoom.us/s/12345678901'),
      zoomMeetingUrl('javascript:alert(1)'),
    ],
    expected: [URL, null, null, null],
  })
})

test('a disappearing Calendar editor waits for delayed send and external-guest confirmations', async () => {
  let tick = 0
  let sent = 0
  let invited = 0
  const page = {
    getByRole: (_role: string, { name }: { name: string }) => ({
      isVisible: async () =>
        name === 'Send' ? tick >= 2 && !sent : name === 'Invite all guests' ? tick >= 4 && !!sent && !invited : false,
      click: async () => {
        if (name === 'Send') sent++
        if (name === 'Invite all guests') invited++
      },
    }),
    waitForTimeout: async () => {
      tick++
    },
  } as unknown as Page
  const result = await finishCalendarInvitation(page, MEETING, URL, async () =>
    invited ? [{ ...EVENT, htmlLink: 'https://calendar.google.com/calendar/event?eid=example' }] : [],
  )
  assert({
    given: 'an editor that disappears before Google shows either send prompt',
    should: 'complete both prompts once and verify the resulting event',
    actual: [sent, invited, tick, result.title],
    expected: [1, 1, 4, MEETING.title],
  })
})
