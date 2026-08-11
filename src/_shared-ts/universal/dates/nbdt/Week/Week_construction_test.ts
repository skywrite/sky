import { assert, test } from '#test'
import { PlainDate, PlainDateTime, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import Week from './mod.ts'

test('Week.of - all input types', () => {
  const fixtures = [
    { value: new PlainDate(2026, 2, 15), expected: '2026-W07', description: 'PlainDate mid-year' },
    { value: '2026-08-11', expected: '2026-W33', description: 'YMD string' },
    { value: new PlainDateTime('2026-02-15 09:00'), expected: '2026-W07', description: 'PlainDateTime' },
    {
      value: new ZonedDateTime(new PlainDateTime('2026-08-11 10:00'), 'America/New_York'),
      expected: '2026-W33',
      description: 'ZonedDateTime',
    },
  ]

  for (const { value, expected, description } of fixtures) {
    assert({
      given: `${value.toString()} (${description})`,
      should: `resolve to ${expected}`,
      actual: Week.of(value).toString(),
      expected,
    })
  }
})

test('Week.of - extended hours resolve to the started day', () => {
  // Sunday 2026-08-16 at 25:30 is 01:30 wall-clock Monday (W34);
  // the un-normalized date part keeps it in the started day's week
  assert({
    given: 'Sunday 2026-08-16 25:30 (extended hours)',
    should: 'resolve to W33, not the wall-clock Monday W34',
    actual: Week.of(new PlainDateTime('2026-08-16 25:30')).toString(),
    expected: '2026-W33',
  })
})

test('Week.of - year-boundary buckets', () => {
  const fixtures = [
    { value: '2027-01-01', expected: '2027-W00', description: 'Jan 1 = Friday, ISO W53 of 2026' },
    { value: '2025-12-29', expected: '2025-W53', description: 'Mon Dec 29, overflow: ISO W1 of 2026' },
    { value: '2026-12-28', expected: '2026-W53', description: 'genuine ISO W53 (long year)' },
    { value: '2026-01-01', expected: '2026-W01', description: 'Jan 1 = Thursday, clipped W01' },
    { value: '2024-01-01', expected: '2024-W01', description: 'Jan 1 = Monday, clean start' },
  ]

  for (const { value, expected, description } of fixtures) {
    assert({
      given: `${value} (${description})`,
      should: `resolve to ${expected}`,
      actual: Week.of(value).toString(),
      expected,
    })
  }
})

test('Week.of - rejects non-YMD strings', () => {
  let threw = false
  try {
    Week.of('08-11')
  } catch {
    threw = true
  }
  assert({
    given: 'a partial date string "08-11"',
    should: 'throw',
    actual: threw,
    expected: true,
  })
})

test('Week.from - validates existence', () => {
  const invalid = [
    { year: 2024, number: 0, description: '2024 starts Monday, no W00' },
    { year: 2013, number: 0, description: '2013 starts Tuesday, no W00' },
    { year: 2023, number: 53, description: '2023 ends Sunday, no W53' },
    { year: 2026, number: 54, description: 'beyond any year' },
    { year: 2026, number: 1.5, description: 'non-integer' },
  ]

  for (const { year, number, description } of invalid) {
    let threw = false
    try {
      Week.from(year, number)
    } catch {
      threw = true
    }
    assert({
      given: `Week.from(${year}, ${number}) (${description})`,
      should: 'throw',
      actual: threw,
      expected: true,
    })
  }

  // 2012 is the maximal year: leap year starting Sunday → both W00 and W53 exist
  assert({
    given: 'Week.from(2012, 0) (leap year starting Sunday)',
    should: 'be valid',
    actual: Week.from(2012, 0).toString(),
    expected: '2012-W00',
  })
  assert({
    given: 'Week.from(2012, 53) (Dec 31 Monday, overflow)',
    should: 'be valid',
    actual: Week.from(2012, 53).toString(),
    expected: '2012-W53',
  })
})

test('Week.parse - forms and errors', () => {
  const fixtures = [
    { input: '34', contextYear: 2026, expected: '2026-W34', description: 'bare number' },
    { input: 'W07', contextYear: 2026, expected: '2026-W07', description: 'W-prefixed' },
    { input: 'w7', contextYear: 2026, expected: '2026-W07', description: 'lowercase, unpadded' },
    { input: '2027-W02', contextYear: undefined, expected: '2027-W02', description: 'long form' },
    { input: '2027-W00', contextYear: undefined, expected: '2027-W00', description: 'long form W00' },
  ]

  for (const { input, contextYear, expected, description } of fixtures) {
    assert({
      given: `"${input}" (${description})`,
      should: `parse to ${expected}`,
      actual: Week.parse(input, contextYear).toString(),
      expected,
    })
  }

  const throwing = [
    { input: '34', contextYear: undefined, description: 'bare number without context year' },
    { input: '0', contextYear: 2024, description: 'week that does not exist in year' },
    { input: '134', contextYear: 2026, description: 'three digits' },
    { input: 'garbage', contextYear: 2026, description: 'not a week at all' },
  ]

  for (const { input, contextYear, description } of throwing) {
    let threw = false
    try {
      Week.parse(input, contextYear)
    } catch {
      threw = true
    }
    assert({
      given: `"${input}" (${description})`,
      should: 'throw',
      actual: threw,
      expected: true,
    })
  }
})

test('Week.lastOfYear', () => {
  const fixtures = [
    { year: 2026, expected: 53, description: 'genuine ISO long year' },
    { year: 2025, expected: 53, description: 'overflow bucket (Dec 29-31)' },
    { year: 2023, expected: 52, description: 'ends cleanly on Sunday' },
    { year: 2021, expected: 52, description: 'clipped W52 (Dec 31 Friday)' },
  ]

  for (const { year, expected, description } of fixtures) {
    assert({
      given: `${year} (${description})`,
      should: `have last week ${expected}`,
      actual: Week.lastOfYear(year),
      expected,
    })
  }
})

test('Week - equals and toString', () => {
  assert({
    given: 'two dates in the same week',
    should: 'be equal',
    actual: Week.of('2026-08-10').equals(Week.of('2026-08-16')),
    expected: true,
  })

  // W53-2026 and W00-2027 share the same true Monday-Sunday week but are
  // distinct buckets — they must not compare equal
  assert({
    given: 'W53-2026 and W00-2027 (same true week, different buckets)',
    should: 'not be equal',
    actual: Week.of('2026-12-28').equals(Week.of('2027-01-01')),
    expected: false,
  })

  assert({
    given: 'a single-digit week number',
    should: 'zero-pad in toString',
    actual: Week.of('2026-02-15').toString(),
    expected: '2026-W07',
  })
})
