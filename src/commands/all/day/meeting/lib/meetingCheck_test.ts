import type { CalendarEvent } from '#lib/google/mod.ts'
import { assert, test } from '#test'
import { compareDayMeetings, type NotebookMeeting, renderMeetingCheck } from './meetingCheck.ts'

const DAY = '2026-01-27'
const ZONE = 'Europe/London'

function event(start: string, end: string, title: string, others: string[] = ['Jane Doe']): CalendarEvent {
  return {
    id: `${start}-${title}`,
    account: 'me@example.com',
    title,
    start: start.length === 5 ? `${DAY}T${start}:00+00:00` : start,
    end: end.length === 5 ? `${DAY}T${end}:00+00:00` : end,
    allDay: false,
    attendees: [
      { email: 'me@example.com', self: true, response: 'accepted' },
      ...others.map((name) => ({
        email: `${name.toLowerCase().replace(' ', '.')}@example.com`,
        name,
        self: false,
        response: 'accepted' as const,
      })),
    ],
    eventType: 'default',
    status: 'confirmed',
  }
}

function meeting(start: string, who: string, end: string | null): NotebookMeeting {
  return { who, medium: 'call', when: { datetime: `${DAY} ${start}`, end: end && `${DAY} ${end}` } }
}

const CALENDAR = {
  timeZone: ZONE,
  meetings: [
    event('09:00', '09:45', 'Standup'),
    event('12:00', '12:30', 'Atlas sync', ['Bob Smith', 'Ann Lee']),
    event('13:30', '14:30', 'Roadmap review'),
    event('15:00', '15:30', 'Board prep', ['Bob Smith']),
  ],
  errors: [],
}

const NOTEBOOK = [
  meeting('09:05', 'Jane Doe', '09:50'), // five minutes late: the standup's record
  meeting('12:20', 'Bob Smith', null), // twenty minutes late is another meeting, and it never ended
  meeting('16:00', 'Sam Roe', '16:20'), // an ad-hoc call the calendar never saw
]

test({ name: 'compareDayMeetings - records match by start time within the tolerance' }, () => {
  const check = compareDayMeetings(DAY, {
    calendar: CALENDAR,
    notebook: NOTEBOOK,
    events: [{ start: '18:00', label: 'Dinner', kind: 'event' }],
  })
  assert({
    given: 'notebook meetings 5 and 20 minutes after two calendar meetings',
    should: 'record the one within 15 minutes and leave the other unrecorded',
    actual: check.meetings.map((m) => m.record?.who ?? null),
    expected: ['Jane Doe', null, null, null],
  })
  assert({
    given: 'both sides answered',
    should: 'mark both read and keep the zone',
    actual: [check.calendarRead, check.notebookRead, check.timeZone, check.errors],
    expected: [true, true, ZONE, []],
  })
  assert({
    given: 'an endless notebook meeting and a start-only event',
    should: 'list both in start order, the meeting labeled by medium and who',
    actual: check.endless,
    expected: [
      { start: '12:20', label: 'call: Bob Smith', kind: 'meeting' },
      { start: '18:00', label: 'Dinner', kind: 'event' },
    ],
  })
})

test({ name: 'compareDayMeetings - an unread side is reported, never thrown' }, () => {
  const noCalendar = compareDayMeetings(DAY, {
    calendar: { timeZone: null, meetings: [], errors: ['keychain locked'] },
    notebook: NOTEBOOK,
    events: [],
  })
  assert({
    given: 'errors and no meetings from the calendar',
    should: 'leave the calendar unread with the errors, and still nudge about endless records',
    actual: [noCalendar.calendarRead, noCalendar.meetings, noCalendar.errors, noCalendar.endless.length],
    expected: [false, [], ['keychain locked'], 1],
  })

  const partial = compareDayMeetings(DAY, {
    calendar: { ...CALENDAR, errors: ['other@example.com: token expired'] },
    notebook: NOTEBOOK,
    events: [],
  })
  assert({
    given: 'meetings from one account and an error from another',
    should: 'still check what came back',
    actual: [partial.calendarRead, partial.meetings.length, partial.errors.length],
    expected: [true, 4, 1],
  })

  const noNotebook = compareDayMeetings(DAY, {
    calendar: CALENDAR,
    notebook: null,
    events: [{ start: '18:00', label: 'Dinner', kind: 'event' }],
  })
  assert({
    given: 'no answer from the service',
    should: 'list the calendar with no records, and only the events side of the end-time nudge',
    actual: [noNotebook.notebookRead, noNotebook.meetings.map((m) => m.record), noNotebook.endless],
    expected: [false, [null, null, null, null], [{ start: '18:00', label: 'Dinner', kind: 'event' }]],
  })
})

test({ name: 'renderMeetingCheck - each meeting is judged against the notebook clock' }, () => {
  const check = compareDayMeetings(DAY, { calendar: CALENDAR, notebook: NOTEBOOK, events: [] })
  const text = renderMeetingCheck(check, { date: DAY, time: '14:05' })
  const lines = text.split('\n')
  assert({
    given: 'four meetings at five past two',
    should: 'open with the day, the zone, the clock, and a tally',
    actual: lines[0],
    expected: `Calendar for ${DAY} (${ZONE}), checked against the notebook's meeting records as of ${DAY} 14:05 — 4 meetings: 1 logged, 1 not logged, 1 in progress, 1 upcoming.`,
  })
  assert({
    given: 'the same render',
    should: 'pair each absolute time with how far away it is, then the people and the status',
    actual: lines.slice(2, 6),
    expected: [
      '- 09:00 - 09:45 (ended 4 hours 20 minutes ago)  Standup  — Jane Doe  — logged (call: Jane Doe)',
      '- 12:00 - 12:30 (ended 1 hour 35 minutes ago)  Atlas sync  — Bob Smith, Ann Lee  — not logged: the notebook has no record of it',
      '- 13:30 - 14:30 (started 35 minutes ago, ends in 25 minutes)  Roadmap review  — Jane Doe  — in progress',
      '- 15:00 - 15:30 (in 55 minutes)  Board prep  — Bob Smith  — upcoming',
    ],
  })
  assert({
    given: 'the same render',
    should: 'close the list with the matching rule and the end-time nudge',
    actual: [
      lines[7].startsWith('A notebook meeting starting within 15 minutes'),
      lines[7].includes('never invent what happened in it'),
      lines.at(-1),
    ],
    expected: [
      true,
      true,
      'Records stating no end time — the when: needs "- HH:MM" or a length: 12:20 call: Bob Smith.',
    ],
  })

  const morning = renderMeetingCheck(check, { date: DAY, time: '08:00' })
  assert({
    given: 'the same day at eight in the morning',
    should: 'call every unrecorded meeting upcoming, and the recorded one logged',
    actual: morning.split('\n')[0].split(' — ')[1],
    expected: '4 meetings: 1 logged, 3 upcoming.',
  })
})

test({ name: 'renderMeetingCheck - the distance is said in whole words at the scale that matters' }, () => {
  const check = compareDayMeetings(DAY, { calendar: CALENDAR, notebook: NOTEBOOK, events: [] })
  const at = (date: string, time: string) => renderMeetingCheck(check, { date, time }).split('\n')
  assert({
    given: 'a clock on the hour before a meeting, and on its start minute',
    should: 'say a bare hour, and just now',
    actual: [at(DAY, '14:00')[5].split('  ')[0], at(DAY, '15:00')[5].split('  ')[0]],
    expected: ['- 15:00 - 15:30 (in 1 hour)', '- 15:00 - 15:30 (started just now, ends in 30 minutes)'],
  })
  assert({
    given: 'a clock two days later',
    should: 'count days and hours and drop the minutes',
    actual: [at('2026-01-29', '10:00')[2].split('  ')[0], at('2026-01-29', '13:00')[5].split('  ')[0]],
    expected: ['- 09:00 - 09:45 (ended 2 days ago)', '- 15:00 - 15:30 (ended 1 day 21 hours ago)'],
  })
  assert({
    given: 'a clock the day before, in extended hours',
    should: 'measure from the civil moment',
    actual: at('2026-01-26', '25:00')[2].split('  ')[0],
    expected: '- 09:00 - 09:45 (in 8 hours)',
  })
})

test({ name: 'renderMeetingCheck - the notebook clock runs past midnight' }, () => {
  const late = compareDayMeetings(DAY, {
    calendar: {
      timeZone: ZONE,
      meetings: [event('23:00', '23:30', 'Night call'), event('23:45', '2026-01-28T00:30:00+00:00', 'Midnight call')],
      errors: [],
    },
    notebook: [],
    events: [],
  })
  assert({
    given: 'a 25:30 notebook clock, which is 01:30 the next civil day',
    should: 'count a meeting that ended after civil midnight as past',
    actual: renderMeetingCheck(late, { date: DAY, time: '25:30' }).split('\n')[0].split(' — ')[1],
    expected: '2 meetings: 2 not logged.',
  })
  assert({
    given: 'a 23:50 notebook clock',
    should: 'still see the midnight call in progress',
    actual: renderMeetingCheck(late, { date: DAY, time: '23:50' }).split('\n')[0].split(' — ')[1],
    expected: '2 meetings: 1 not logged, 1 in progress.',
  })
})

test({ name: 'renderMeetingCheck - what the model reads when a side could not be read' }, () => {
  const noCalendar = compareDayMeetings(DAY, {
    calendar: { timeZone: null, meetings: [], errors: ['No Google accounts are authorized yet. Run: sky google:auth'] },
    notebook: [meeting('12:20', 'Bob Smith', null)],
    events: [],
  })
  assert({
    given: 'an unread calendar',
    should: 'say so with the reason, and still carry the end-time nudge',
    actual: renderMeetingCheck(noCalendar, { date: DAY, time: '14:05' }).split('\n'),
    expected: [
      `The calendar for ${DAY} could not be checked as of ${DAY} 14:05: No Google accounts are authorized yet. Run: sky google:auth`,
      '',
      'Records stating no end time — the when: needs "- HH:MM" or a length: 12:20 call: Bob Smith.',
    ],
  })

  const empty = compareDayMeetings(DAY, { calendar: { ...CALENDAR, meetings: [] }, notebook: [], events: [] })
  assert({
    given: 'an empty calendar',
    should: 'say so in one line',
    actual: renderMeetingCheck(empty, { date: DAY, time: '14:05' }),
    expected: `No meetings on the calendar for ${DAY} (${ZONE}), as of ${DAY} 14:05.`,
  })

  const noNotebook = compareDayMeetings(DAY, { calendar: CALENDAR, notebook: null, events: [] })
  const lines = renderMeetingCheck(noNotebook, { date: DAY, time: '14:05' }).split('\n')
  assert({
    given: 'an unread notebook',
    should: 'list the calendar, say the logged state is unknown, and give past meetings no status',
    actual: [
      lines[0].endsWith('— 4 meetings. The notebook could not be queried, so which of them are logged is unknown.'),
      lines[2],
      lines[5],
    ],
    expected: [
      true,
      '- 09:00 - 09:45 (ended 4 hours 20 minutes ago)  Standup  — Jane Doe',
      '- 15:00 - 15:30 (in 55 minutes)  Board prep  — Bob Smith  — upcoming',
    ],
  })
})
