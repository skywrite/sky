import { assert, test } from '#test'
import PlainDateTime from './mod.ts'

test('PlainDateTime.until - wall-clock durations', () => {
  assert({
    given: 'two times the same day',
    should: 'measure the minutes between',
    actual: PlainDateTime.fromString('2026-03-15 09:00')
      .until(PlainDateTime.fromString('2026-03-15 09:45'))
      .total('milliseconds'),
    expected: 45 * 60_000,
  })
  assert({
    given: 'times across a day boundary',
    should: 'cross it',
    actual: PlainDateTime.fromString('2026-03-15 23:30')
      .until(PlainDateTime.fromString('2026-03-16 00:30'))
      .total('milliseconds'),
    expected: 60 * 60_000,
  })
  assert({
    given: 'an other earlier than this',
    should: 'be negative',
    actual: PlainDateTime.fromString('2026-03-16 10:00')
      .until(PlainDateTime.fromString('2026-03-15 10:00'))
      .total('hours'),
    expected: -24,
  })
  assert({
    given: 'an extended-hour time and its normalized twin',
    should: 'be the same moment',
    actual: PlainDateTime.fromString('2026-03-15 25:30')
      .until(PlainDateTime.fromString('2026-03-16 01:30'))
      .total('milliseconds'),
    expected: 0,
  })
  assert({
    given: 'a multi-day span',
    should: 'balance to hours (nbdt Duration has no days)',
    actual: PlainDateTime.fromString('2026-03-15 10:00').until(PlainDateTime.fromString('2026-03-17 11:30')).toString(),
    expected: 'PT49H30M',
  })
})

test('PlainDateTime.since - until with the direction reversed', () => {
  assert({
    given: 'a time and one 90 minutes earlier',
    should: 'read positively since it',
    actual: PlainDateTime.fromString('2026-03-15 10:30')
      .since(PlainDateTime.fromString('2026-03-15 09:00'))
      .total('minutes'),
    expected: 90,
  })
})
