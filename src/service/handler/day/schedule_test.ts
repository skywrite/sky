import type { CalendarEvent } from '#lib/google/mod.ts'
import PeopleStore from '#shared/models/Store/PeopleStore/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { createScanners } from '../../scanner/scan.ts'
import type { PersonScore } from '../../scoring/ScoringStore.ts'
import { Store } from '../../store.ts'
import type { MeetingRow } from './record.ts'
import { createScheduleRoutes, type DaySchedule, type ScheduleHost, scheduleOf } from './schedule.ts'

const DAY = '2026-01-27'

test('family notifications do not consume meeting records or count as meetings', () => {
  const schedule = scheduleOf({
    day: DAY,
    events: [event('Atlas sync', '10:00', '10:30')],
    notifications: [
      {
        ...event('School closure', '10:00', '11:00'),
        classification: { key: 'a'.repeat(64), type: 'notification', source: 'automatic' },
      },
    ],
    records: [record('Atlas notes', '10:00')],
    clock: { date: DAY, time: '18:00' },
    read: true,
    errors: [],
  })
  assert({
    given: 'a family notice and a meeting at the same time',
    should: 'reserve the notebook record for the meeting and retain the notice separately',
    actual: [
      schedule.meetings.length,
      schedule.meetings[0].record?.title,
      schedule.notifications?.map((row) => [row.title, row.record, row.joinUrl, row.classification?.type]),
    ],
    expected: [1, 'Atlas notes', [['School closure', null, null, 'notification']]],
  })
})

test('event type corrections validate identity and type, and report stale events and write failures', async () => {
  const writes: unknown[] = []
  const key = 'a'.repeat(64)
  const host: ScheduleHost = async () => ({ read: true, meetings: [], errors: [] })
  host.setType = async (day, id, type) => {
    writes.push([day.ymd, id, type])
    if (id !== key) return false
    if (type === 'notification') throw new Error('Storage unavailable')
    return true
  }
  const app = createScheduleRoutes(host)
  const send = (body: unknown, day = DAY) =>
    app.request(`/${day}/schedule/type`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  const statuses: number[] = []
  for (const body of [
    { key, type: 'meeting' },
    { key, type: null },
    { key, type: 'unknown' },
    { key: '../escape', type: 'meeting' },
    { key: 'b'.repeat(64), type: 'meeting' },
    { key, type: 'notification' },
  ]) {
    statuses.push((await send(body)).status)
  }
  statuses.push((await send({ key, type: 'meeting' }, 'not-a-day')).status)
  assert({
    given: 'valid corrections, malformed input, a vanished event and a failed save',
    should: 'save only valid requests and return actionable errors for everything else',
    actual: [statuses, writes.length],
    expected: [[200, 200, 400, 400, 404, 500, 404], 4],
  })
})

function attendee(email: string, name?: string, self = false): CalendarEvent['attendees'][number] {
  return { email, name, self, response: 'accepted' }
}

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

async function peopleOf(...profiles: Record<string, unknown>[]): Promise<PeopleStore> {
  const people = await PeopleStore.build([])
  profiles.forEach((profile, index) => {
    people.set(`/notebook/people/Contact-${index}.md`, `---\n${JSON.stringify(profile)}\n---\n`)
  })
  return people
}

function familiarScores(...names: string[]): PersonScore[] {
  return names.map((name) => ({ name, score: 100, familiarityScore: 100, lastInteraction: DAY, interactionCount: 10 }))
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
    expected: ['Board prep sync', 'Old call', null],
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

test('schedule - email matches use familiar notebook names before calendar labels', async () => {
  const people = await peopleOf(
    {
      name: ['Sam Rivera', 'Samuel Rivera', 'Sam'],
      email: { personal: 'sam.home@example.com', business: ['sam@example.com', 'SAM@example.com'] },
    },
    { name: ['Mary Jane', 'Mary Jane Doe'], email: ['mj@example.com'] },
    { name: ['Alex Chen', 'atlas/alex'], email: 'alex@example.com' },
  )
  const schedule = scheduleOf({
    day: DAY,
    events: [
      event('Planning', '10:00', '10:30', {
        attendees: [
          attendee('me@example.com', undefined, true),
          attendee(' SAM@example.com ', 'Samuel Rivera'),
          attendee('mj@example.com'),
          attendee('alex@example.com'),
          attendee('taylor@example.com', 'Taylor Morgan'),
          attendee('unknown@example.com'),
          attendee('blank@example.com', '  '),
        ],
      }),
    ],
    records: [],
    clock: { date: DAY, time: '09:00' },
    read: true,
    errors: [],
    people,
    personScores: familiarScores('Sam Rivera', 'Mary Jane', 'Alex Chen'),
  })
  assert({
    given: 'explicit contact addresses, nicknames, a compound name, a scoped alias, and unknown guests',
    should: 'use familiar names for contacts and retain useful calendar or address fallbacks',
    actual: schedule.meetings[0].who,
    expected: ['Sam', 'Mary Jane', 'Alex', 'Taylor Morgan', 'unknown@example.com', 'blank@example.com'],
  })
})

test('schedule - namesakes expand per meeting and shared addresses identify no single person', async () => {
  const people = await peopleOf(
    { name: ['Sam Rivera', 'Sam'], email: 'sam.rivera@example.com' },
    { name: ['Sam', 'Sam Lee'], email: 'sam.lee@example.com' },
    { name: 'Jane Doe', email: ['support@example.com', 'staff@example.com'] },
    { name: 'Alex Chen', email: ['SUPPORT@example.com', 'staff@example.com'] },
  )
  const schedule = scheduleOf({
    day: DAY,
    events: [
      event('Together', '10:00', '10:30', {
        attendees: [attendee('sam.rivera@example.com'), attendee('sam.lee@example.com')],
      }),
      event('One person', '11:00', '11:30', { attendees: [attendee('sam.rivera@example.com')] }),
      event('Support', '12:00', '12:30', {
        attendees: [attendee('support@example.com', 'Support team'), attendee('staff@example.com')],
      }),
    ],
    records: [],
    clock: { date: DAY, time: '09:00' },
    read: true,
    errors: [],
    people,
    personScores: familiarScores('Sam Rivera', 'Sam Lee'),
  })
  assert({
    given: 'two Sams together, one of them alone, and two contacts claiming the same addresses',
    should: 'disambiguate only the shared meeting and leave shared mailbox labels intact',
    actual: schedule.meetings.map((meeting) => meeting.who),
    expected: [['Sam Rivera', 'Sam Lee'], ['Sam'], ['Support team', 'staff@example.com']],
  })
})

test('schedule - family and direct contact qualify for short names, while mentions alone do not', async () => {
  const people = await peopleOf(
    { name: ['Jane Doe', 'Janie'], email: 'jane@example.com', tags: ['Person/Family/Daughter'] },
    { name: ['Sam Rivera', 'Sam'], email: 'sam@example.com' },
    { name: 'Taylor Quinn', email: 'taylor@example.com' },
    { name: 'Alex Chen', email: 'alex@example.com' },
  )
  const store = new Store()
  const scanners = createScanners(store, { isTimeFile: () => true }, { referenceDate: new PlainDate(DAY) })
  for (const { doc, path } of people.getAll()) scanners.readFileAndUpdatePeople(doc.toMarkdown(), path)
  for (let index = 0; index < 120; index++) {
    const who = index < 10 ? 'who: Sam Rivera\n' : ''
    scanners.trackPersonInteractions(
      `---\n${who}rel: Taylor Quinn\n---\n`,
      `/nb/time/2026/W05/01-27/actions/meetings/09-00_Zoom_Planning-${index}.md`,
    )
  }
  const app = createScheduleRoutes(async () =>
    scheduleOf({
      day: DAY,
      events: [
        event('Planning', '10:00', '10:30', {
          attendees: ['jane', 'sam', 'taylor', 'alex'].map((name) => attendee(`${name}@example.com`)),
        }),
      ],
      records: [],
      clock: { date: DAY, time: '09:00' },
      read: true,
      errors: [],
      people,
      personScores: store.getPeopleWithScores(),
    }),
  )
  const who = async () => {
    const response = await app.request(`/${DAY}/schedule`)
    return ((await response.json()) as DaySchedule).meetings[0].who
  }
  assert({
    given: 'a family member, ten direct meetings, frequent discussion of another person, and an unfamiliar guest',
    should: 'shorten only the family member and the person with enough direct contact',
    actual: await who(),
    expected: ['Janie', 'Sam', 'Taylor Quinn', 'Alex Chen'],
  })
  const mentioned = store.getPeopleWithScores().find((person) => person.name === 'Taylor Quinn')!
  assert({
    given: 'more than one hundred relevance points from mentions alone',
    should: 'retain the relevance while reporting no familiarity',
    actual: [mentioned.score, mentioned.familiarityScore],
    expected: [120, 0],
  })
  scanners.forgetFile('/notebook/people/Contact-0.md')
  scanners.readFileAndUpdatePeople('---\nname: [Jane Doe, Janie]\n---\n', '/notebook/people/Contact-0.md')
  scanners.forgetFile('/nb/time/2026/W05/01-27/actions/meetings/09-00_Zoom_Planning-0.md')
  assert({
    given: 'a family tag removed and direct contact falling below the threshold while the route remains alive',
    should: 'use full names on its next response',
    actual: await who(),
    expected: ['Jane Doe', 'Sam Rivera', 'Taylor Quinn', 'Alex Chen'],
  })
})

test('schedule - the short-name threshold uses familiarity, with unknown scores treated conservatively', async () => {
  const people = await peopleOf({ name: ['Sam Rivera', 'Sam'], email: 'sam@example.com' })
  const labels = [99.9, 100, undefined].map(
    (familiarityScore) =>
      scheduleOf({
        day: DAY,
        events: [event('Planning', '10:00', '10:30', { attendees: [attendee('sam@example.com')] })],
        records: [],
        clock: { date: DAY, time: '09:00' },
        read: true,
        errors: [],
        people,
        personScores: [{ ...familiarScores('Sam Rivera')[0]!, score: 1000, familiarityScore }],
      }).meetings[0].who,
  )
  assert({
    given: 'high relevance with familiarity below, at, or missing from the threshold',
    should: 'shorten only at one hundred points of known familiarity',
    actual: labels,
    expected: [['Sam Rivera'], ['Sam'], ['Sam Rivera']],
  })
})

test('schedule route - contact edits refresh names and removed addresses stop resolving', async () => {
  const people = await peopleOf({ name: 'Alex Chen', email: 'alex@example.com' })
  const app = createScheduleRoutes(async () =>
    scheduleOf({
      day: DAY,
      events: [event('Planning', '10:00', '10:30', { attendees: [attendee('alex@example.com')] })],
      records: [],
      clock: { date: DAY, time: '09:00' },
      read: true,
      errors: [],
      people,
      personScores: familiarScores('Alex Chen'),
    }),
  )
  const who = async () => {
    const response = await app.request(`/${DAY}/schedule`)
    return ((await response.json()) as DaySchedule).meetings[0].who
  }
  const before = await who()
  people.set('/notebook/people/Contact-0.md', '---\nname: [Lex, Alex Chen]\nemail: alex@example.com\n---\n')
  const renamed = await who()
  people.set('/notebook/people/Contact-0.md', '---\nname: [Lex, Alex Chen]\nemail: lex@example.com\n---\n')
  assert({
    given: 'a contact renamed and then moved to a different email while the route stays alive',
    should: 'use each current profile without a server restart or stale email match',
    actual: [before, renamed, await who()],
    expected: [['Alex'], ['Lex'], ['alex@example.com']],
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

test('meetings remain available without a calendar and include inline records', () => {
  const inline = { ...record('Jane Doe Zoom', '10:00'), path: 'time/2026/W05/01-27/day.md', inline: true }
  const schedule = scheduleOf({
    day: DAY,
    events: [],
    records: [record('Afternoon call', '14:00'), inline],
    clock: { date: DAY, time: '18:00' },
    read: false,
    errors: ['Calendar unavailable'],
  })
  assert({
    given: 'inline and filed records with an unavailable calendar',
    should: 'retain both in time order with their links',
    actual: {
      read: schedule.read,
      meetings: schedule.meetings.map((m) => [m.start, m.record?.title, m.record?.inline ?? false]),
    },
    expected: {
      read: false,
      meetings: [
        ['10:00', 'Jane Doe Zoom', true],
        ['14:00', 'Afternoon call', false],
      ],
    },
  })
})

test('a recorded meeting is matched to at most one calendar event', () => {
  const schedule = scheduleOf({
    day: DAY,
    events: [event('Planning', '10:00', '10:30'), event('Other call', '10:10', '10:40')],
    records: [{ ...record('Planning notes', '10:00'), inline: true }],
    clock: { date: DAY, time: '18:00' },
    read: true,
    errors: [],
  })
  assert({
    given: 'two calendar events near one inline record',
    should: 'include the record once',
    actual: schedule.meetings.map((m) => m.record?.title ?? null),
    expected: ['Planning notes', null],
  })
})
