import { assert, test } from '#test'
import ZonedDateTime from './mod.ts'

test('ZonedDateTime.toString', () => {
  const zdt = new ZonedDateTime('2024-03-15 14:30', 'America/Los_Angeles')

  assert({
    given: 'a ZonedDateTime',
    should: 'format as string with timezone',
    actual: zdt.toString(),
    expected: '2024-03-15 14:30 America/Los_Angeles',
  })
})

test('ZonedDateTime.clone', () => {
  const zdt = new ZonedDateTime('2024-03-15 14:30', 'Asia/Tokyo')
  const clone = zdt.clone()

  assert({
    given: 'cloning a ZonedDateTime',
    should: 'create equal string representation',
    actual: clone.toString(),
    expected: zdt.toString(),
  })

  assert({
    given: 'cloning a ZonedDateTime',
    should: 'create different instance',
    actual: clone !== zdt,
    expected: true,
  })
})

test('ZonedDateTime.addHours', () => {
  const zdt = new ZonedDateTime('2024-03-15 23:30', 'America/Los_Angeles')
  const later = zdt.addHours(3)

  assert({
    given: 'adding hours past midnight',
    should: 'support extended hours',
    actual: later.plainDateTime.time,
    expected: '26:30',
  })

  assert({
    given: 'adding hours',
    should: 'keep same timezone',
    actual: later.timezone,
    expected: 'America/Los_Angeles',
  })
})

test('ZonedDateTime.now', () => {
  const zdt = ZonedDateTime.now('Europe/Paris')

  assert({
    given: 'creating current time with timezone',
    should: 'set correct timezone',
    actual: zdt.timezone,
    expected: 'Europe/Paris',
  })

  assert({
    given: 'creating current time',
    should: 'have valid date format',
    actual: /^\d{4}-\d{2}-\d{2}$/.test(zdt.plainDateTime.date),
    expected: true,
  })
})

test('ZonedDateTime.fromString', () => {
  const zdt = ZonedDateTime.fromString('2024-03-15 14:30 America/New_York')

  assert({
    given: 'parsing string with timezone',
    should: 'extract date and time',
    actual: zdt.plainDateTime.toString(),
    expected: '2024-03-15 14:30',
  })

  assert({
    given: 'parsing string with timezone',
    should: 'extract timezone',
    actual: zdt.timezone,
    expected: 'America/New_York',
  })
})
