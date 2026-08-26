import { assert, test } from '#test'
import expandToYMD from './expandToYMD.ts'

const REF_DATE = '2022-10-01'
const FIXTURES = [
  { input: '15', refDate: REF_DATE, expected: '2022-10-15' },
  { input: '10-15', refDate: REF_DATE, expected: '2022-10-15' },
  { input: '2022-10-15', refDate: REF_DATE, expected: '2022-10-15' },
  { input: '10-31', refDate: '2022-11-02', expected: '2022-10-31' },
  { input: '2-10', refDate: '2023-04-29', expected: '2023-02-10' },
]

test(expandToYMD.name, () => {
  const given = 'a valid YMD string or integers'
  const should = 'return a valid YMD string'

  FIXTURES.forEach(({ input, refDate, expected }) => {
    assert({
      given,
      should,
      actual: expandToYMD(input, refDate),
      expected,
    })
  })
})

test(expandToYMD.name, () => {
  const given = 'a invalid YMD string or integers'
  const should = 'throw'

  let thrown = false
  try {
    expandToYMD('', REF_DATE)
  } catch {
    thrown = true
  }

  assert({
    given,
    should,
    expected: true,
    actual: thrown,
  })
})

// Returns what expandToYMD produced, or '(threw)' — so a failed assertion
// shows the wrong date the input silently became.
const result = (input: string, refDate: string): string => {
  try {
    return expandToYMD(input, refDate)
  } catch {
    return '(threw)'
  }
}

test(`${expandToYMD.name} refuses impossible dates instead of letting JS Date roll them`, () => {
  const impossible = [
    '2026-02-29', // Feb 29 of a non-leap year
    '6-31', // a day no month has
    '2026-13-05', // a thirteenth month
    '0', // day zero
    '26-04-22', // a two-digit year, which new Date(y, m, d) maps into the 1900s
  ]

  assert({
    given: 'dates that do not exist on the calendar',
    should: 'throw for each rather than return a different date than was typed',
    actual: impossible.map((input) => `${input} -> ${result(input, REF_DATE)}`),
    expected: impossible.map((input) => `${input} -> (threw)`),
  })
})

test(`${expandToYMD.name} treats the reference date as a calendar day, not an instant`, () => {
  // The signature admits only calendar days (string | Temporal.PlainDate), so
  // there is no UTC-midnight instant left to misread across timezones.
  assert({
    given: 'a reference date given as a calendar day',
    should: 'expand into that month and year on any host clock or timezone',
    actual: expandToYMD('27', '2026-08-01'),
    expected: '2026-08-27',
  })
})
