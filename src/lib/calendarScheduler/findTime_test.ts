import type { CalendarEvent } from '#lib/google/calendar.ts'
import { assert, test } from '#test'
import {
  availabilityMessage,
  defaultAvailabilityTemplate,
  defaultDayLineStyle,
  formatErrors,
  rangeKey,
} from './availabilityMessage.ts'
import { findAvailableTimes, windowsSchema, type AvailabilitySearch } from './findTime.ts'

const monday = '2030-05-06'
const search: AvailabilitySearch = {
  dates: [monday, '2030-05-07', '2030-05-08'],
  startTime: '12:00',
  endTime: '17:00',
  timezone: 'America/Chicago',
  displayTimezone: 'America/Los_Angeles',
  bufferMinutes: 15,
  minimumMinutes: 30,
}
const before = '2030-05-05T09:00:00Z'
const event = (start: string, end: string, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: start,
  account: 'jane@example.com',
  title: 'Private calendar event',
  start,
  end,
  allDay: false,
  attendees: [],
  eventType: 'default',
  status: 'confirmed',
  ...extra,
})

test('availability combines owned calendars, applies buffers even outside search hours and copies one bullet per selected day', async () => {
  const events = [
    event(monday + 'T11:00:00-05:00', monday + 'T11:55:00-05:00', { title: 'Morning review' }),
    event(monday + 'T13:30:00-05:00', monday + 'T14:00:00-05:00', { title: 'Busy', iCalUid: 'review' }),
    event(monday + 'T15:00:00-05:00', monday + 'T16:30:00-05:00', {
      title: 'Optional office hours',
      transparency: 'transparent',
    }),
    event('2030-05-07', '2030-05-08', { allDay: true, title: 'Team retreat' }),
    event('2030-05-08', '2030-05-09', { allDay: true, selfResponse: 'declined' }),
  ]
  let reads = 0
  const { days } = await findAvailableTimes(
    search,
    async () => {
      reads++
      return {
        warnings: [],
        sources: [
          { id: 'work', label: 'Work', events },
          {
            id: 'personal',
            label: 'Personal',
            events: [
              { ...events[1]!, id: 'synced-copy', title: 'Design review', start: monday + 'T18:30:00Z' },
              event(monday + 'T13:30:00-05:00', monday + 'T14:00:00-05:00', {
                id: 'another-meeting',
                title: 'Studio call',
              }),
              event(monday + 'T13:45:00-05:00', monday + 'T14:30:00-05:00', { title: 'Project kickoff' }),
            ],
          },
        ],
      }
    },
    before,
  )
  const offers = days.map((day) => day.entries.filter((entry) => entry.kind === 'free'))
  assert({
    given: 'three local afternoons with overlapping meetings, a prior boundary meeting and one all-day block',
    should: 'read the date span once, merge duplicates, and show only usable Pacific openings',
    actual: [reads, offers.map((entries) => entries.map((entry) => entry.label))],
    expected: [1, [['10:10–11:15 am', '12:45–3 pm'], [], ['10 am–3 pm']]],
  })
  assert({
    given: 'two calendars with shared copies, overlapping events and an entry marked free',
    should: 'show each actual event once with its full time, even outside the search hours',
    actual: days.map((day) =>
      day.entries.filter((entry) => entry.kind !== 'free').map((entry) => [entry.title, entry.label, entry.kind]),
    ),
    expected: [
      [
        ['Morning review', '9–9:55 am', 'busy'],
        ['Design review', '11:30 am–12 pm', 'busy'],
        ['Studio call', '11:30 am–12 pm', 'busy'],
        ['Project kickoff', '11:45 am–12:30 pm', 'busy'],
        ['Optional office hours', '1–2:30 pm', 'nonblocking'],
      ],
      [['Team retreat', 'All day', 'busy']],
      [],
    ],
  })
  const selection = new Set(offers[0]!.map(rangeKey))
  assert({
    given: 'only the two Monday ranges selected',
    should: 'copy only the selected day with both ranges and no calendar details',
    actual: availabilityMessage(defaultAvailabilityTemplate, days, selection, 'Pacific'),
    expected:
      'Here’s when I’m free (all times Pacific).\n\n• Mon, May 6: 10:10–11:15 am or 12:45–3 pm\n\nWould any of those work for you?',
  })
  const format = {
    template: 'My openings\n\n{{days}}',
    dayLine: '  - {{times}} ({{weekday}}, {{date}} · {{timezone}})',
    timeSeparator: ' / ',
  }
  assert({
    given: 'a custom line with the openings first, separate date fields and a time zone on each day',
    should: 'preserve its literal indentation and separator and format only selected times',
    actual: [formatErrors(format), availabilityMessage(format.template, days, selection, 'Pacific', format)],
    expected: [
      { template: '', dayLine: '', timeSeparator: '' },
      'My openings\n\n  - 10:10–11:15 am / 12:45–3 pm (Monday, May 6 · Pacific)',
    ],
  })
})

test('availability templates validate the field that needs editing', () => {
  const format = { template: defaultAvailabilityTemplate, ...defaultDayLineStyle }
  assert({
    given: 'missing day or time fields, an unknown placeholder, a missing time zone or a multiline separator',
    should: 'identify the affected field while accepting a plain line without a bullet',
    actual: [
      !!formatErrors({ ...format, dayLine: '{{times}}' }).dayLine,
      !!formatErrors({ ...format, dayLine: '{{day}}' }).dayLine,
      !!formatErrors({ ...format, dayLine: '{{day}} {{event}} {{times}}' }).dayLine,
      !!formatErrors({ ...format, template: '{{days}}' }).template,
      !!formatErrors({ ...format, timeSeparator: '\n' }).timeSeparator,
      formatErrors({ ...format, dayLine: '{{weekday}} {{times}}', timeSeparator: ', ' }).dayLine,
    ],
    expected: [true, true, true, true, true, ''],
  })
})

test('start-minute rules apply after the buffer and leave enough time for the meeting', async () => {
  const events = [
    event(monday + 'T11:30:00-05:00', monday + 'T12:00:00-05:00'),
    event(monday + 'T13:20:00-05:00', monday + 'T14:05:00-05:00'),
    event(monday + 'T15:10:00-05:00', monday + 'T16:30:00-05:00'),
  ]
  const read = async () => ({ warnings: [], sources: [{ id: 'work', label: 'Work', events }] })
  const options = { ...search, dates: [monday] }
  const unrestricted = await findAvailableTimes(options, read, before)
  const restricted = windowsSchema.parse({ ...options, startMinutes: [30, 0, 30] })
  const { days } = await findAvailableTimes(restricted, read, before)
  const offers = (result: typeof days) => result[0]!.entries.filter((e) => e.kind === 'free').map((e) => e.label)
  assert({
    given: 'Pacific openings starting at 10:15 and 12:20 after buffering, with a 30-minute meeting to fit',
    should: 'round the first start forward, keep its actual end, and drop the gap that becomes too short',
    actual: [restricted.startMinutes, offers(unrestricted.days), offers(days)],
    expected: [[0, 30], ['10:15–11:05 am', '12:20–12:55 pm'], ['10:30–11:05 am']],
  })
  const message = (selection: Set<string> | null) =>
    availabilityMessage(defaultAvailabilityTemplate, days, selection, 'Pacific', undefined, restricted.startMinutes)
  assert({
    given: 'a start restriction in a copy-ready email',
    should: 'include the rule once with the selected day and yield an empty message when nothing is selected',
    actual: [message(null), message(new Set()), windowsSchema.safeParse({ ...options, startMinutes: [60] }).success],
    expected: [
      'Here’s when I’m free (all times Pacific).\n\n• Mon, May 6: 10:30–11:05 am\n\nI can start on the hour or half hour.\n\nWould any of those work for you?',
      '',
      false,
    ],
  })
})

test('start marks follow the displayed clock across offsets, clock changes and the current minute', async () => {
  const read = async () => ({ warnings: [], sources: [{ id: 'studio', label: 'Studio', events: [] }] })
  const offers = async (options: Partial<AvailabilitySearch>, now = '2030-01-01T00:00:00Z') => {
    const { days } = await findAvailableTimes(
      {
        ...search,
        dates: [monday],
        timezone: 'UTC',
        displayTimezone: 'Asia/Kathmandu',
        startTime: '09:00',
        endTime: '10:00',
        startMinutes: [0, 30],
        ...options,
      },
      read,
      now,
    )
    return days[0]!.entries.filter((e) => e.kind === 'free').map((e) => e.label)
  }
  assert({
    given: 'a quarter-hour-offset display zone, skipped and repeated hours, and half-past-only starts',
    should: 'choose a real eligible instant, keep exact fits and never offer a start in the past',
    actual: [
      await offers({}),
      await offers({
        dates: ['2030-03-10'],
        displayTimezone: 'America/New_York',
        startTime: '06:46',
        endTime: '07:30',
      }),
      await offers({
        dates: ['2030-11-03'],
        displayTimezone: 'America/New_York',
        startTime: '05:50',
        endTime: '06:30',
      }),
      await offers({ displayTimezone: 'UTC', startMinutes: [30] }, monday + 'T09:30:00Z'),
      await offers({ displayTimezone: 'UTC', startMinutes: [30] }, monday + 'T09:30:01Z'),
    ],
    expected: [['3–3:45 pm'], ['3–3:30 am'], ['1–1:30 am'], ['9:30–10 am'], []],
  })
})

test('availability uses the recipient date and elapsed time across clock changes', async () => {
  const empty = async () => ({ sources: [{ id: 'work', label: 'Work', events: [] }], warnings: [] })
  const {
    days: [tokyo],
  } = await findAvailableTimes({ ...search, dates: [monday], displayTimezone: 'Asia/Tokyo' }, empty, before)
  const {
    days: [dst],
  } = await findAvailableTimes(
    {
      ...search,
      dates: ['2030-03-10'],
      startTime: '01:00',
      endTime: '04:00',
      timezone: 'America/New_York',
      displayTimezone: 'America/New_York',
    },
    empty,
    '2030-01-01T00:00:00Z',
  )
  assert({
    given: 'afternoons in Chicago displayed in Tokyo, and a search across spring forward',
    should: 'label Tuesday in Japan and retain the real two-hour interval in New York',
    actual: [tokyo?.date, tokyo?.entries[0]?.label, dst!.entries[0]!.end - dst!.entries[0]!.start],
    expected: ['2030-05-07', '2–7 am', 120 * 60_000],
  })
})

test('overnight events and openings appear on both display days and a selected opening is copied once', async () => {
  const tuesday = '2030-05-07'
  const events = [
    event(monday + 'T23:30:00+02:00', tuesday + 'T00:30:00+02:00', {
      title: 'Optional drop-in',
      transparency: 'transparent',
    }),
    event(tuesday, '2030-05-08', { allDay: true, eventType: 'workingLocation', title: 'In the office' }),
  ]
  const { days } = await findAvailableTimes(
    { ...search, dates: [monday], startTime: '16:00', endTime: '18:00', displayTimezone: 'Europe/Paris' },
    async () => ({ sources: [{ id: 'work', label: 'Work', events }], warnings: [] }),
    before,
  )
  const secondDayOpening = days[1]!.entries.find((entry) => entry.kind === 'free')!
  assert({
    given: 'an opening and a transparent event that cross midnight in the display zone',
    should: 'show the true dates in each column, keep the all-day entry on its calendar date, and share one range',
    actual: [
      days.map((day) =>
        day.entries.filter((entry) => entry.kind !== 'free').map((entry) => [entry.title, entry.label]),
      ),
      secondDayOpening.label,
      availabilityMessage('{{timezone}}\n{{days}}', days, new Set([rangeKey(secondDayOpening)]), 'Paris'),
    ],
    expected: [
      [
        [['Optional drop-in', '11:30 pm–Tue, May 7 12:30 am']],
        [
          ['In the office', 'All day'],
          ['Optional drop-in', 'Mon, May 6 11:30 pm–12:30 am'],
        ],
      ],
      'Mon, May 6 11 pm–1 am',
      'Paris\n• Mon, May 6: 11 pm–Tue, May 7 1 am',
    ],
  })
})

test('an all-day agenda entry remains valid on a date that begins after midnight', async () => {
  const date = '2030-03-10'
  const zone = 'America/Havana'
  const events = [event(date, '2030-03-11', { allDay: true, title: 'Team retreat' })]
  const {
    days: [day],
  } = await findAvailableTimes(
    { ...search, dates: [date], timezone: zone, displayTimezone: zone },
    async () => ({ sources: [{ id: 'work', label: 'Work', events }], warnings: [] }),
    '2030-03-01T12:00:00Z',
  )
  assert({
    given: 'an all-day block on a clock change that skips midnight',
    should: 'show the event and block the afternoon for its actual civil date',
    actual: day?.entries.map((entry) => [entry.kind, entry.label]),
    expected: [['busy', 'All day']],
  })
})

test('incomplete calendars and past or too-short gaps cannot become offers', async () => {
  const options = { ...search, dates: [monday] }
  const read = async () => ({ sources: [{ id: 'work', label: 'Work', events: [] }], warnings: [] })
  const {
    days: [failed],
  } = await findAvailableTimes(
    options,
    async () => ({ ...(await read()), warnings: ['Could not check Personal.'] }),
    before,
  )
  const {
    days: [past],
  } = await findAvailableTimes(options, read, '2030-05-06T21:45:01Z')
  const {
    days: [today],
  } = await findAvailableTimes(options, read, '2030-05-06T21:00:01Z')
  assert({
    given: 'an incomplete read, a 14-minute gap, and an ongoing afternoon with seconds elapsed',
    should: 'explain missing coverage, apply the meeting length, and round the current minute up',
    actual: [failed?.warnings, failed?.entries, past?.entries, today?.entries[0]?.label],
    expected: [['Could not check Personal.'], [], [], '2:01–3 pm'],
  })
})

test('calendar choices and ignored occurrences change the buffered openings before the email is built', async () => {
  const tuesday = '2030-05-07'
  const options = {
    ...search,
    dates: [monday, tuesday],
    startTime: '09:00',
    endTime: '13:00',
    timezone: 'UTC',
    displayTimezone: 'UTC',
  }
  const reminder = (date: string) =>
    event(date + 'T10:00:00Z', date + 'T11:00:00Z', { iCalUid: 'weekly-reminder', title: 'Supply pickup' })
  const read = async () => ({
    sources: [
      { id: 'studio', label: 'Studio', events: [reminder(monday), reminder(tuesday)] },
      {
        id: 'home',
        label: 'Home',
        events: [reminder(monday), event(monday + 'T10:45:00Z', monday + 'T11:45:00Z', { title: 'Team review' })],
      },
    ],
    warnings: [],
  })
  const initial = await findAvailableTimes(options, read, before)
  const occurrence = initial.days[0]!.entries.find((e) => e.kind === 'busy' && e.title === 'Supply pickup')
  if (occurrence?.kind !== 'busy') throw new Error('Missing reminder')
  const ignored = await findAvailableTimes({ ...options, ignoredEvents: [occurrence.id] }, read, before)
  const one = await findAvailableTimes({ ...options, disabledCalendars: ['home'] }, read, before)
  const allOff = await findAvailableTimes({ ...options, disabledCalendars: ['home', 'studio'] }, read, before)
  const offers = (result: typeof initial) =>
    result.days.map((day) => day.entries.filter((e) => e.kind === 'free').map((e) => e.label))
  assert({
    given: 'a shared reminder, another occurrence in the series, and an overlapping meeting on a second calendar',
    should:
      'release only the ignored occurrence and its buffer, retain enabled conflicts and keep every calendar available to restore',
    actual: [
      offers(ignored),
      ignored.days[0]!.entries.filter((e) => e.kind === 'ignored').length,
      offers(one),
      offers(allOff),
      allOff.calendars.map((c) => c.id),
      allOff.days[0]!.warnings,
    ],
    expected: [
      [
        ['9–10:30 am', '12–1 pm'],
        ['9–9:45 am', '11:15 am–1 pm'],
      ],
      1,
      [
        ['9–9:45 am', '11:15 am–1 pm'],
        ['9–9:45 am', '11:15 am–1 pm'],
      ],
      [['9 am–1 pm'], ['9 am–1 pm']],
      ['home', 'studio'],
      [],
    ],
  })
  const failed = async () => ({
    sources: [
      { id: 'main', label: 'Schedule', events: [] },
      { id: 'other', label: 'Schedule', events: [], warning: 'Could not check the second calendar.' },
    ],
    warnings: [],
  })
  const enabledFailure = await findAvailableTimes(options, failed, before)
  const disabledFailure = await findAvailableTimes({ ...options, disabledCalendars: ['other'] }, failed, before)
  assert({
    given: 'two calendars with the same name and a failed read',
    should: 'withhold offers only while the affected calendar counts, and preserve distinct switch identities',
    actual: [
      offers(enabledFailure),
      offers(disabledFailure),
      disabledFailure.calendars.map((c) => c.id),
      disabledFailure.days[0]!.warnings,
    ],
    expected: [[[], []], [['9 am–1 pm'], ['9 am–1 pm']], ['main', 'other'], []],
  })
})
