import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { clockPrefix, dayClock, dayLabel } from './clock.ts'

const day = PlainDate.from('2026-02-08')

test('dayClock renders same-day instants as plain wall clock', () => {
  assert({
    given: 'an instant during the day (UTC day, UTC zone)',
    should: 'render HH:MM',
    expected: '09:12',
    actual: dayClock(new Date('2026-02-08T09:12:00Z'), day, 'UTC'),
  })

  assert({
    given: 'a single-digit hour',
    should: 'zero-pad it',
    expected: '07:05',
    actual: dayClock(new Date('2026-02-08T07:05:00Z'), day, 'UTC'),
  })
})

test('dayClock renders after-midnight instants in extended hours', () => {
  assert({
    given: 'an instant at 01:44 the next calendar day',
    should: 'render as 25:44 under the day it extends',
    expected: '25:44',
    actual: dayClock(new Date('2026-02-09T01:44:00Z'), day, 'UTC'),
  })
})

test('dayClock respects the timezone', () => {
  assert({
    given: '00:30 UTC on Feb 9, viewed from UTC+2 (Europe/Athens in winter)',
    should: 'render as the local 02:30 next day → 26:30',
    expected: '26:30',
    actual: dayClock(new Date('2026-02-09T00:30:00Z'), day, 'Europe/Athens'),
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
