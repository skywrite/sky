import { assert, test } from '#test'
import { isValidPattern, patterns } from './patterns.ts'

test('isValidPattern - quarterly weekend ordinals are valid', () => {
  // The matcher honors all seven weekdays; the static list used to stop at FRI
  const fixtures = ['QUARTERLY-FIRST-SAT', 'QUARTERLY-FIRST-SUN', 'QUARTERLY-LAST-SAT', 'QUARTERLY-LAST-SUN']

  fixtures.forEach((pattern) => {
    assert({
      given: pattern,
      should: 'be valid',
      actual: isValidPattern(pattern),
      expected: true,
    })
  })
})

test('isValidPattern - numeric patterns are bounded to days that can occur', () => {
  const fixtures = [
    { pattern: 'MONTHLY-1', expected: true },
    { pattern: 'MONTHLY-31', expected: true },
    { pattern: 'MONTHLY-0', expected: false }, // no 0th day
    { pattern: 'MONTHLY-32', expected: false },
    { pattern: 'MONTHLY-45', expected: false },
    { pattern: 'MONTHLY-LAST-0', expected: true }, // the last day itself
    { pattern: 'MONTHLY-LAST-30', expected: true }, // day 1 of a 31-day month
    { pattern: 'MONTHLY-LAST-31', expected: false },
    { pattern: 'QUARTERLY-1', expected: true },
    { pattern: 'QUARTERLY-92', expected: true }, // Q3 and Q4 hold 92 days
    { pattern: 'QUARTERLY-0', expected: false },
    { pattern: 'QUARTERLY-93', expected: false },
    { pattern: 'QUARTERLY-LAST-91', expected: true },
    { pattern: 'QUARTERLY-LAST-92', expected: false },
    { pattern: 'QUARTERLY-MONTH-BEFORE-31', expected: true }, // Dec and Mar have 31 days
    { pattern: 'QUARTERLY-MONTH-BEFORE-0', expected: false },
    { pattern: 'QUARTERLY-MONTH-BEFORE-32', expected: false },
  ]

  fixtures.forEach((fixture) => {
    assert({
      given: fixture.pattern,
      should: fixture.expected ? 'be valid' : 'be invalid',
      actual: isValidPattern(fixture.pattern),
      expected: fixture.expected,
    })
  })
})

test('isValidPattern - static, deprecated, and case-insensitive lookups still hold', () => {
  const fixtures = [
    { pattern: 'EVERY-MON', expected: true },
    { pattern: 'ALTERNATE-WED', expected: true }, // deprecated but honored
    { pattern: 'quarterly-first-sun', expected: true }, // case-insensitive
    { pattern: 'EVERY-MONDAY', expected: false }, // full day names never existed in this grammar
    { pattern: 'MONTHLY-FIRST-MONDAY', expected: false },
    { pattern: 'EVERY-WEEKDAYS', expected: false },
  ]

  fixtures.forEach((fixture) => {
    assert({
      given: fixture.pattern,
      should: fixture.expected ? 'be valid' : 'be invalid',
      actual: isValidPattern(fixture.pattern),
      expected: fixture.expected,
    })
  })
})

test('isValidPattern - every entry in the static list validates', () => {
  const invalid = patterns.filter((p) => !isValidPattern(p.pattern))

  assert({
    given: `${patterns.length} static patterns`,
    should: 'all pass their own validator',
    actual: invalid.map((p) => p.pattern),
    expected: [],
  })
})
