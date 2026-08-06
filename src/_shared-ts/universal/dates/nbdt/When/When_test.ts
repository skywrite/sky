import { assert, test } from '#test'
import PlainDateTime from '../PlainDateTime/mod.ts'
import When from './mod.ts'

const parses = [
  {
    given: 'a moment with no length',
    input: '2026-08-05 07:13',
    datetime: '2026-08-05 07:13',
    duration: null,
    durationMinutes: null,
    end: null,
    canonical: '2026-08-05 07:13',
  },
  {
    given: 'a length in minutes',
    input: '2026-08-05 10:15 70m',
    datetime: '2026-08-05 10:15',
    duration: '70m',
    durationMinutes: 70,
    end: '2026-08-05 11:25',
    canonical: '2026-08-05 10:15 70m',
  },
  {
    given: 'a length in hours',
    input: '2026-08-05 10:00 3h',
    datetime: '2026-08-05 10:00',
    duration: '3h',
    durationMinutes: 180,
    end: '2026-08-05 13:00',
    canonical: '2026-08-05 10:00 3h',
  },
  {
    given: 'an end time',
    input: '2026-08-05 10:15 - 11:25',
    datetime: '2026-08-05 10:15',
    duration: '70m',
    durationMinutes: 70,
    end: '2026-08-05 11:25',
    canonical: '2026-08-05 10:15 - 11:25',
  },
  {
    given: 'an unspaced dash',
    input: '2026-08-05 10:15-11:25',
    datetime: '2026-08-05 10:15',
    duration: '70m',
    durationMinutes: 70,
    end: '2026-08-05 11:25',
    canonical: '2026-08-05 10:15 - 11:25',
  },
  {
    given: 'an extended-hours start',
    input: '2026-08-04 25:30 40m',
    datetime: '2026-08-04 25:30',
    duration: '40m',
    durationMinutes: 40,
    end: '2026-08-04 26:10',
    canonical: '2026-08-04 25:30 40m',
  },
  {
    given: 'a range crossing midnight in extended hours',
    input: '2026-08-04 23:30 - 24:30',
    datetime: '2026-08-04 23:30',
    duration: '60m',
    durationMinutes: 60,
    end: '2026-08-04 24:30',
    canonical: '2026-08-04 23:30 - 24:30',
  },
  {
    given: 'a sub-minute length',
    input: '2026-08-05 13:24 45s',
    datetime: '2026-08-05 13:24',
    duration: '45s',
    durationMinutes: 1,
    end: '2026-08-05 13:25',
    canonical: '2026-08-05 13:24 45s',
  },
  {
    given: 'an unpadded hour from a hand edit',
    input: '2026-08-05 9:15 30m',
    datetime: '2026-08-05 09:15',
    duration: '30m',
    durationMinutes: 30,
    end: '2026-08-05 09:45',
    canonical: '2026-08-05 09:15 30m',
  },
]

parses.forEach(({ given, input, datetime, duration, durationMinutes, end, canonical }) => {
  test(`When.fromYaml parses ${given}`, () => {
    const when = When.fromYaml(input)
    assert({ given, should: 'read the datetime', actual: when.datetime.toString(), expected: datetime })
    assert({ given, should: 'expose duration', actual: when.duration, expected: duration })
    assert({ given, should: 'expose durationMinutes', actual: when.durationMinutes, expected: durationMinutes })
    assert({ given, should: 'derive end', actual: when.end === null ? null : when.end.toString(), expected: end })
    assert({ given, should: 'serialize canonically', actual: when.toYaml(), expected: canonical })
  })
})

test('When preserves the length form it was written in', () => {
  assert({
    given: 'a value written as a range',
    should: 'serialize back as a range, not a duration',
    actual: When.fromYaml('2026-08-05 10:15 - 11:25').toYaml(),
    expected: '2026-08-05 10:15 - 11:25',
  })
  assert({
    given: 'a value written as a duration',
    should: 'serialize back as a duration, not a range',
    actual: When.fromYaml('2026-08-05 10:15 70m').toYaml(),
    expected: '2026-08-05 10:15 70m',
  })
})

test('When.toJSON emits the string form', () => {
  assert({
    given: 'JSON.stringify(when)',
    should: 'emit the one-line string',
    actual: JSON.stringify(When.fromYaml('2026-08-05 10:15 70m')),
    expected: '"2026-08-05 10:15 70m"',
  })
})

const rejects = [
  { given: 'the old object form', input: { datetime: '2026-08-05 10:15', duration: '70m' } },
  { given: 'a bare time with no date', input: '10:15' },
  { given: 'a legacy range with no date', input: '10:15 - 11:25' },
  { given: 'a bare date with no time', input: '2026-08-05' },
  { given: 'a number', input: 42 },
  { given: 'null', input: null },
  { given: 'undefined', input: undefined },
  { given: 'an empty string', input: '' },
  { given: 'a T separator', input: '2026-08-05T10:15' },
  { given: 'seconds in the time', input: '2026-08-05 10:15:30' },
  { given: 'a garbage length', input: '2026-08-05 10:15 seventy' },
  { given: 'a zero length', input: '2026-08-05 10:15 0m' },
  { given: 'a negative length', input: '2026-08-05 10:15 -30m' },
  { given: 'an end equal to the start', input: '2026-08-05 10:15 - 10:15' },
  { given: 'an end before the start', input: '2026-08-05 23:30 - 00:30' },
  { given: 'trailing junk', input: '2026-08-05 10:15 70m extra' },
  { given: 'a timezone marker', input: '2026-08-05 10:15 CDT' },
]

rejects.forEach(({ given, input }) => {
  test(`When.fromYaml rejects ${given}`, () => {
    let threw = false
    try {
      When.fromYaml(input)
    } catch {
      threw = true
    }
    assert({ given, should: 'throw', actual: threw, expected: true })
  })
})

test('When.fromYaml names the extended-hours fix on a backwards range', () => {
  let message = ''
  try {
    When.fromYaml('2026-08-05 23:30 - 00:30')
  } catch (error) {
    message = (error as Error).message
  }
  assert({
    given: 'a range that crosses midnight the wrong way',
    should: 'suggest the extended-hours spelling',
    actual: message.includes('24:30'),
    expected: true,
  })
})

test('When.from builds from a PlainDateTime', () => {
  const when = When.from(PlainDateTime.fromString('2026-08-05 10:15'))
  assert({ given: 'a PlainDateTime', should: 'serialize', actual: when.toYaml(), expected: '2026-08-05 10:15' })
})

test('When.from attaches a length to a PlainDateTime', () => {
  const when = When.from(PlainDateTime.fromString('2026-08-05 10:15'), '70m')
  assert({
    given: 'a PlainDateTime and 70m',
    should: 'serialize both',
    actual: when.toYaml(),
    expected: '2026-08-05 10:15 70m',
  })
  assert({
    given: 'a PlainDateTime and 70m',
    should: 'derive end',
    actual: when.end?.toString(),
    expected: '2026-08-05 11:25',
  })
})

test('When.from passes a When through unchanged', () => {
  const original = When.fromYaml('2026-08-05 10:15 - 11:25')
  assert({
    given: 'a When',
    should: 'return it as-is',
    actual: When.from(original).toYaml(),
    expected: original.toYaml(),
  })
})
