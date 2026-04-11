import { assert, test } from '#test'
import ZonedDateTime from './mod.ts'

test('inTimeZone vs withTimeZone - different behaviors', () => {
  const nyc = new ZonedDateTime('2024-03-15 15:00', 'America/New_York')

  // inTimeZone: converts to show what time it is in Chicago at the same instant
  // 3 PM NYC -> 2 PM Chicago (same moment, different wall clock)
  const chicagoConverted = nyc.inTimeZone('America/Chicago')

  assert({
    given: 'inTimeZone from NYC to Chicago',
    should: 'show earlier time (2 PM)',
    actual: chicagoConverted.plainDateTime.time,
    expected: '14:00', // One hour earlier
  })

  assert({
    given: 'inTimeZone conversion',
    should: 'be the same instant',
    actual: chicagoConverted.isSameInstant(nyc),
    expected: true,
  })

  // withTimeZone: keeps the same PlainDateTime, just assigns new timezone
  // 3 PM stays 3 PM, but now it's 3 PM Chicago (different instant)
  const chicagoReassigned = nyc.withTimeZone('America/Chicago')

  assert({
    given: 'withTimeZone from NYC to Chicago',
    should: 'keep same wall clock time (3 PM)',
    actual: chicagoReassigned.plainDateTime.time,
    expected: '15:00', // Same time
  })

  assert({
    given: 'withTimeZone reassignment',
    should: 'be a different instant',
    actual: chicagoReassigned.isSameInstant(nyc),
    expected: false,
  })
})

test('inTimeZone - practical travel example', () => {
  // You're in LA at 9 AM and want to know what time it is in Hong Kong
  const la = new ZonedDateTime('2024-03-15 09:00', 'America/Los_Angeles')
  const hk = la.inTimeZone('Asia/Hong_Kong')

  // HK is typically 15-16 hours ahead of LA (depending on DST)
  // So 9 AM LA would be around midnight/1 AM next day in HK
  assert({
    given: '9 AM in LA converted to HK',
    should: 'be much later (past midnight)',
    actual: parseInt(hk.plainDateTime.time.split(':')[0]) >= 24,
    expected: true, // Should show extended hours
  })
})

test('withTimeZone - reassignment use case', () => {
  // You land in a new timezone and set your watch to local time
  // without caring about the conversion
  const departure = new ZonedDateTime('2024-03-15 14:00', 'America/Los_Angeles')

  // You land and it's 14:00 local time in Hong Kong
  // You just want to set your time to 14:00 HK (not convert)
  const arrival = departure.withTimeZone('Asia/Hong_Kong')

  assert({
    given: 'reassigning timezone on arrival',
    should: 'keep the same time value',
    actual: arrival.plainDateTime.toString(),
    expected: departure.plainDateTime.toString(),
  })

  assert({
    given: 'reassigning timezone',
    should: 'have different timezone',
    actual: arrival.timezone,
    expected: 'Asia/Hong_Kong',
  })
})
