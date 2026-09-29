import type { CalendarRecurrence } from '#lib/calendarScheduler/types.ts'
import { validateMeeting } from '#lib/calendarScheduler/validation.ts'
import { assert, test } from '#test'
import type { CalendarEvent } from './calendar.ts'
import { calendarRecurrenceMatches, calendarRepeatSummaryMatches } from './calendarRecurrence.ts'

const timing = {
  date: '2030-10-25',
  time: '15:00',
  timezone: 'America/New_York',
  recurrence: { frequency: 'weekly', interval: 1, ends: { type: 'never' } } as CalendarRecurrence,
}
const parent = (recurrence: string[]): CalendarEvent => ({
  id: 'series',
  account: 'organizer@example.com',
  title: 'Atlas planning',
  start: '2030-10-25T15:00:00-04:00',
  end: '2030-10-25T15:30:00-04:00',
  allDay: false,
  attendees: [],
  eventType: 'default',
  status: 'confirmed',
  timezone: timing.timezone,
  recurrence,
})

test('native recurrence readback verifies the civil end date across daylight saving', () => {
  const bounded = { ...timing, recurrence: { ...timing.recurrence, ends: { type: 'on', date: '2030-11-08' } as const } }
  assert({
    given: 'weekly meetings across the fall offset change, with no end or an inclusive end date',
    should: 'accept only the requested civil end, without adding a day or ending before the final occurrence',
    actual: [
      calendarRecurrenceMatches(parent(['RRULE:FREQ=WEEKLY;BYDAY=FR']), timing),
      ...['20301109T045959Z', '20301110T045959Z', '20301108T185959Z'].map((until) =>
        calendarRecurrenceMatches(parent([`RRULE:FREQ=WEEKLY;BYDAY=FR;UNTIL=${until}`]), bounded),
      ),
    ],
    expected: [true, true, false, false],
  })
})

test('readback verifies the parent recurrence, timezone, cadence and end rather than an expanded instance', () => {
  const counted = {
    ...timing,
    recurrence: { ...timing.recurrence, interval: 2, ends: { type: 'after', count: 13 } as const },
  }
  const valid = parent(['RRULE:FREQ=WEEKLY;COUNT=13;BYDAY=FR;INTERVAL=2;WKST=MO'])
  assert({
    given: 'a native series and near matches that would create the wrong invitation',
    should: 'accept only the full reviewed series',
    actual: [
      calendarRecurrenceMatches(valid, counted),
      calendarRecurrenceMatches({ ...valid, recurringEventId: 'series', recurrence: undefined }, counted),
      calendarRecurrenceMatches(parent([]), counted),
      calendarRecurrenceMatches({ ...valid, timezone: 'UTC' }, counted),
      ...[
        'RRULE:FREQ=WEEKLY;COUNT=13;INTERVAL=1;BYDAY=FR',
        'RRULE:FREQ=WEEKLY;COUNT=12;INTERVAL=2;BYDAY=FR',
        'RRULE:FREQ=WEEKLY;COUNT=13;INTERVAL=2;BYDAY=MO,FR',
        'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=FR',
        'RRULE:FREQ=WEEKLY;COUNT=13;INTERVAL=2;BYDAY=FR;BYSETPOS=1',
      ].map((rule) => calendarRecurrenceMatches(parent([rule]), counted)),
      calendarRecurrenceMatches(parent(['RRULE:FREQ=WEEKLY;BYDAY=FR', 'EXDATE:20301101T190000Z']), timing),
      calendarRecurrenceMatches(valid, { ...timing, recurrence: undefined }),
    ],
    expected: [true, false, false, false, false, false, false, false, false, false, false],
  })
})

test('daily, monthly and yearly repeats preserve their start date anchor and explicit count', () => {
  assert({
    given: 'three supported repeat frequencies',
    should: 'verify the native rule without substituting an ordinal monthly weekday',
    actual: (
      [
        ['daily', 'RRULE:FREQ=DAILY;COUNT=4'],
        ['monthly', 'RRULE:FREQ=MONTHLY;BYMONTHDAY=25;COUNT=4'],
        ['yearly', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYMONTHDAY=25;COUNT=4'],
      ] as const
    ).map(([frequency, rule]) => {
      const fields = { ...timing, recurrence: { frequency, interval: 1, ends: { type: 'after', count: 4 } as const } }
      return calendarRecurrenceMatches(parent([rule]), fields)
    }),
    expected: [true, true, true],
  })
})

test('the browser rejects a missing or changed repeat selection before saving', () => {
  assert({
    given: 'the repeat control after editing, including shifted dates and weekdays',
    should: 'verify the complete selected cadence and bound',
    actual: [
      calendarRepeatSummaryMatches('Weekly on Friday', timing),
      calendarRepeatSummaryMatches('Does not repeat', timing),
      calendarRepeatSummaryMatches('Weekly on Monday', timing),
      calendarRepeatSummaryMatches('Weekly on Friday, 13 times', timing),
      calendarRepeatSummaryMatches('Weekly on Friday, until Nov 8, 2030', {
        ...timing,
        recurrence: { ...timing.recurrence, ends: { type: 'on', date: '2030-11-08' } },
      }),
      calendarRepeatSummaryMatches('Weekly on Friday, until Nov 9, 2030', {
        ...timing,
        recurrence: { ...timing.recurrence, ends: { type: 'on', date: '2030-11-08' } },
      }),
      calendarRepeatSummaryMatches('Weekly on Thursday', { ...timing, timezone: 'Asia/Tokyo' }),
      calendarRepeatSummaryMatches('Every 2 weeks on Friday, 13 times', {
        ...timing,
        recurrence: { ...timing.recurrence, interval: 2, ends: { type: 'after', count: 13 } },
      }),
    ],
    expected: [true, false, false, false, true, false, false, true],
  })
})

test('invalid recurrence cannot be silently dropped when a draft is reviewed', () => {
  const fields = {
    ...timing,
    title: 'Atlas planning',
    duration: 30,
    account: 'organizer@example.com',
    guests: [],
    description: '',
  }
  const invalid = [
    { ...timing.recurrence, interval: 0 },
    { ...timing.recurrence, ends: { type: 'on', date: '2030-02-30' } },
    { ...timing.recurrence, ends: { type: 'on', date: '2030-10-24' } },
    { ...timing.recurrence, ends: { type: 'after', count: 0 } },
    { ...timing.recurrence, weekdays: ['MO', 'FR'] },
  ]
  assert({
    given: 'bad intervals, bounds or unimplemented repeat fields',
    should: 'reject each draft rather than create a different series',
    actual: invalid.map((recurrence) => {
      try {
        validateMeeting({ ...fields, recurrence })
        return false
      } catch {
        return true
      }
    }),
    expected: [true, true, true, true, true],
  })
})
