import type { CalendarEvent } from '#lib/google/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import type { MeetingRow } from './record.ts'
import { createScheduleRoutes, type DaySchedule, scheduleOf } from './schedule.ts'

const DAY = '2026-01-27'

function event(title: string, start: string, end: string, extra: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: `${title}-${start}`,
    account: 'me@example.com',
    title,
    start: `${DAY}T${start}:00-05:00`,
    end: `${DAY}T${end}:00-05:00`,
    allDay: false,
    attendees: [
      { email: 'me@example.com', self: true, response: 'accepted' },
      { email: 'jane@example.com', name: 'Jane Doe', response: 'accepted' },
      { email: 'alex@example.com', name: 'Alex Chen', response: 'accepted' },
    ],
    eventType: 'default',
    status: 'confirmed',
    ...extra,
  } as CalendarEvent
}

function record(title: string, when: string): MeetingRow {
  return {
    title,
    path: `time/2026/W05/01-27/actions/meetings/${title.replace(/\s+/g, '_')}.md`,
    when,
    summary: null,
    who: 'Jane Doe, Alex Chen',
  }
}

test({ name: 'schedule - each meeting stands past, now, or next against the notebook clock' }, () => {
  const schedule = scheduleOf({
    day: DAY,
    events: [
      event('Standup', '08:15', '08:30'),
      event('Vendor call', '11:30', '12:00'),
      event('Hiring call', '14:00', '14:30'),
    ],
    records: [],
    clock: { date: DAY, time: '11:36' },
    read: true,
    errors: [],
  })

  assert({
    given: 'three meetings and a clock inside the second',
    should: 'mark them past, now, and next in start order',
    actual: schedule.meetings.map((m) => `${m.start} ${m.state}`),
    expected: ['08:15 past', '11:30 now', '14:00 next'],
  })
})

test({ name: 'schedule - another day is wholly past or wholly ahead' }, () => {
  const events = [event('Standup', '08:15', '08:30')]
  const yesterday = scheduleOf({
    day: DAY,
    events,
    records: [],
    clock: { date: '2026-01-28', time: '07:00' },
    read: true,
    errors: [],
  })
  const tomorrow = scheduleOf({
    day: DAY,
    events,
    records: [],
    clock: { date: '2026-01-26', time: '23:00' },
    read: true,
    errors: [],
  })

  assert({
    given: 'the clock on the day after, then on the day before',
    should: 'read the meeting as past, then as next, whatever its hour',
    actual: [yesterday.meetings[0].state, tomorrow.meetings[0].state],
    expected: ['past', 'next'],
  })
})

test({ name: "schedule - a record within the tolerance is the meeting's record" }, () => {
  const schedule = scheduleOf({
    day: DAY,
    events: [event('Board prep sync', '09:00', '09:45'), event('Vendor call', '11:30', '12:00')],
    records: [record('Board prep sync', '09:07 - 09:50'), record('Old call', '10:15 45m')],
    clock: { date: DAY, time: '13:00' },
    read: true,
    errors: [],
  })

  assert({
    given: 'a record seven minutes after one start and none near the other',
    should: 'link the first meeting to its record and leave the second without',
    actual: schedule.meetings.map((m) => m.record?.title ?? null),
    expected: ['Board prep sync', null],
  })
})

test({ name: 'schedule - the row carries who is coming and where to join' }, () => {
  const schedule = scheduleOf({
    day: DAY,
    events: [event('Vendor call', '11:30', '12:00', { conferenceUrl: 'https://meet.example.com/abc' })],
    records: [],
    clock: { date: DAY, time: '11:36' },
    read: true,
    errors: [],
  })

  assert({
    given: 'a meeting with two others and a conference link',
    should: 'name the others without the owner and carry the link',
    actual: { who: schedule.meetings[0].who, join: schedule.meetings[0].joinUrl },
    expected: { who: ['Jane Doe', 'Alex Chen'], join: 'https://meet.example.com/abc' },
  })
})

test({ name: 'schedule - a calendar that did not answer reads as not read, with its reasons' }, () => {
  const schedule = scheduleOf({
    day: DAY,
    events: [],
    records: [],
    clock: { date: DAY, time: '11:36' },
    read: false,
    errors: ['No Google accounts are authorized yet. Run: sky google:auth'],
  })

  assert({
    given: 'no calendar answer',
    should: 'say so and list no meetings',
    actual: { read: schedule.read, meetings: schedule.meetings.length, errors: schedule.errors.length },
    expected: { read: false, meetings: 0, errors: 1 },
  })
})

test({ name: 'schedule route - answers a day and refuses anything else' }, async () => {
  const answered: DaySchedule = { read: true, errors: [], meetings: [] }
  const asked: string[] = []
  const app = createScheduleRoutes(async (day: PlainDate) => {
    asked.push(day.ymd)
    return answered
  })

  const ok = await app.request(`/${DAY}/schedule`)
  const bad = await app.request('/not-a-day/schedule')

  assert({
    given: 'a day and a word that is not one',
    should: "answer the day with the host's schedule and 404 the word",
    actual: { ok: ok.status, body: await ok.json(), bad: bad.status, asked },
    expected: { ok: 200, body: answered, bad: 404, asked: [DAY] },
  })
})
