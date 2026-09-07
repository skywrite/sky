import { assert, test } from '#test'
import { Instant, PlainDate } from '#universal/dates/nbdt/mod.ts'
import { clockPrefix, dayClock, dayLabel } from './clock.ts'

const day = PlainDate.from('2026-02-08')

test('dayClock renders same-day instants as plain wall clock', () => {
  assert({
    given: 'an instant during the day (UTC day, UTC zone)',
    should: 'render HH:MM',
    expected: '09:12',
    actual: dayClock(Instant.from('2026-02-08T09:12:00Z'), day, 'UTC'),
  })

  assert({
    given: 'a single-digit hour',
    should: 'zero-pad it',
    expected: '07:05',
    actual: dayClock(Instant.from('2026-02-08T07:05:00Z'), day, 'UTC'),
  })
})

test('dayClock renders after-midnight instants in extended hours', () => {
  assert({
    given: 'an instant at 01:44 the next calendar day',
    should: 'render as 25:44 under the day it extends',
    expected: '25:44',
    actual: dayClock(Instant.from('2026-02-09T01:44:00Z'), day, 'UTC'),
  })
})

test('dayClock respects the timezone', () => {
  assert({
    given: '00:30 UTC on Feb 9, viewed from UTC+2 (Europe/Athens in winter)',
    should: 'render as the local 02:30 next day → 26:30',
    expected: '26:30',
    actual: dayClock(Instant.from('2026-02-09T00:30:00Z'), day, 'Europe/Athens'),
  })
})

test('dayClock uses the offset at the event across daylight saving transitions', () => {
  const spring = PlainDate.from('2026-03-08')
  const autumn = PlainDate.from('2026-11-01')
  assert({
    given: 'instants on either side of the spring clock jump',
    should: 'skip the missing hour',
    actual: ['2026-03-08T07:59:59Z', '2026-03-08T08:00:00Z'].map((value) =>
      dayClock(Instant.from(value), spring, 'America/Chicago'),
    ),
    expected: ['01:59', '03:00'],
  })
  assert({
    given: 'the two occurrences of 01:30 in autumn',
    should: 'render the same local clock for both distinct instants',
    actual: ['2026-11-01T06:30:00Z', '2026-11-01T07:30:00Z'].map((value) =>
      dayClock(Instant.from(value), autumn, 'America/Chicago'),
    ),
    expected: ['01:30', '01:30'],
  })
})

test('clockPrefix converts a clock to a filename prefix', () => {
  assert({
    given: 'an extended-hours clock',
    should: 'swap the colon for a dash',
    expected: '25-44',
    actual: clockPrefix('25:44'),
  })
})

test('dayLabel renders a short human date', () => {
  assert({
    given: 'a PlainDate',
    should: 'render Mon D',
    expected: 'Feb 8',
    actual: dayLabel(day),
  })
})
