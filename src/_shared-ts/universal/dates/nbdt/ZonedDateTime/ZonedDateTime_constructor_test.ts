import { assert, test } from '#test'
import ZonedDateTime from './mod.ts'
import PlainDateTime from '../PlainDateTime/mod.ts'

test('ZonedDateTime constructor - no arguments', () => {
  const zdt = new ZonedDateTime()

  assert({
    given: 'no arguments',
    should: 'create ZonedDateTime with current time and timezone',
    actual: zdt.timezone.length > 0,
    expected: true,
  })

  assert({
    given: 'no arguments',
    should: 'have a valid PlainDateTime',
    actual: zdt.plainDateTime instanceof PlainDateTime,
    expected: true,
  })
})

test('ZonedDateTime constructor - with string and timezone', () => {
  const zdt = new ZonedDateTime('2024-03-15 14:30', 'America/Los_Angeles')

  assert({
    given: 'a date string and timezone',
    should: 'set the correct timezone',
    actual: zdt.timezone,
    expected: 'America/Los_Angeles',
  })

  assert({
    given: 'a date string and timezone',
    should: 'preserve the date and time',
    actual: zdt.plainDateTime.toString(),
    expected: '2024-03-15 14:30',
  })
})

test('ZonedDateTime constructor - with PlainDateTime', () => {
  const pdt = new PlainDateTime('2024-03-15 26:30') // 2:30 AM next day
  const zdt = new ZonedDateTime(pdt, 'Asia/Hong_Kong')

  assert({
    given: 'a PlainDateTime with extended hours',
    should: 'preserve extended hours',
    actual: zdt.plainDateTime.time,
    expected: '26:30',
  })

  assert({
    given: 'a PlainDateTime with timezone',
    should: 'set the correct timezone',
    actual: zdt.timezone,
    expected: 'Asia/Hong_Kong',
  })
})

test('ZonedDateTime constructor - with options object', () => {
  const zdt = new ZonedDateTime({
    date: '2024-03-15',
    time: '14:30',
    timezone: 'Europe/London',
  })

  assert({
    given: 'constructor options',
    should: 'create correct PlainDateTime',
    actual: zdt.plainDateTime.toString(),
    expected: '2024-03-15 14:30',
  })

  assert({
    given: 'constructor options',
    should: 'set correct timezone',
    actual: zdt.timezone,
    expected: 'Europe/London',
  })
})
