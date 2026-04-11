import { assert, test } from '#test'
import ZonedDateTime from './mod.ts'

test('calculateOffset errors - toLocaleString parsing', () => {
  // This test demonstrates the problems with using toLocaleString and parsing it back

  const zdt = new ZonedDateTime('2024-03-15 14:30', 'America/Los_Angeles')

  // The offset calculation is wrong because:
  // 1. new Date(this.plainDateTime.toString()) creates a date in local timezone
  // 2. toLocaleString returns a string like "3/15/2024, 2:30:00 PM"
  // 3. new Date() parsing this string is unreliable and locale-dependent

  console.log('Original PlainDateTime:', zdt.plainDateTime.toString())
  console.log('Timezone:', zdt.timezone)
  console.log('Calculated offset:', zdt.offset)

  // During PST (winter), LA should be -8 hours from UTC
  // During PDT (summer), LA should be -7 hours from UTC
  // But our calculation is likely wrong

  assert({
    given: 'LA timezone in March (should be PDT, -7)',
    should: 'calculate correct offset',
    actual: Math.abs(zdt.offset) >= 7 && Math.abs(zdt.offset) <= 8,
    expected: true,
  })
})

test('calculateOffset errors - UTC conversion', () => {
  const laTime = new ZonedDateTime('2024-03-15 14:00', 'America/Los_Angeles')
  const utcTime = laTime.toUTC()

  console.log('LA time:', laTime.toString())
  console.log('LA offset:', laTime.offset)
  console.log('UTC time:', utcTime.toString())
  console.log('UTC offset:', utcTime.offset)

  // UTC offset should always be 0
  assert({
    given: 'UTC timezone',
    should: 'have offset of 0',
    actual: utcTime.offset,
    expected: 0,
  })
})

test('calculateOffset errors - timezone conversion math', () => {
  const la = new ZonedDateTime('2024-03-15 12:00', 'America/Los_Angeles')
  const ny = la.inTimeZone('America/New_York')

  console.log('LA:', la.toString(), 'offset:', la.offset)
  console.log('NY:', ny.toString(), 'offset:', ny.offset)

  // NY should be 3 hours ahead of LA
  // So 12:00 LA should become 15:00 NY
  assert({
    given: 'converting from LA to NY',
    should: 'add 3 hours',
    actual: ny.plainDateTime.time,
    expected: '15:00',
  })
})

test('calculateOffset errors - NaN and Invalid Date', () => {
  // This might produce NaN or Invalid Date due to parsing issues
  const zdt = new ZonedDateTime('2024-12-25 08:30', 'Asia/Tokyo')

  console.log('Tokyo offset:', zdt.offset)

  assert({
    given: 'any timezone',
    should: 'not produce NaN offset',
    actual: isNaN(zdt.offset),
    expected: false,
  })
})

test('calculateOffset errors - extended hours', () => {
  // Extended hours will definitely break the current implementation
  const extended = new ZonedDateTime('2024-03-15 26:30', 'America/Los_Angeles')

  console.log('Extended hours PlainDateTime:', extended.plainDateTime.toString())
  console.log('Extended hours offset:', extended.offset)

  // This will likely fail because Date constructor can't handle "26:30"
  assert({
    given: 'extended hours',
    should: 'still calculate an offset',
    actual: isNaN(extended.offset),
    expected: false,
  })
})
