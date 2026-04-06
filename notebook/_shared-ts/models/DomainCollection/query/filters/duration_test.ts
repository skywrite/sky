import { assert, test } from '#test'
import { parseDuration } from './duration.ts'

const fixtures = [
  { input: '7d', expected: 7, description: '7 days' },
  { input: '14d', expected: 14, description: '14 days' },
  { input: '1w', expected: 7, description: '1 week' },
  { input: '2w', expected: 14, description: '2 weeks' },
  { input: '1m', expected: 30, description: '1 month legacy (approx)' },
  { input: '3m', expected: 90, description: '3 months legacy (approx)' },
  { input: '1mo', expected: 30, description: '1 month (approx)' },
  { input: '6mo', expected: 180, description: '6 months (approx)' },
  { input: '1y', expected: 365, description: '1 year' },
  { input: '2y', expected: 730, description: '2 years' },
]

for (const { input, expected, description } of fixtures) {
  test(`parseDuration - ${description}`, () => {
    assert({
      given: `duration "${input}"`,
      should: `return ${expected} days`,
      actual: parseDuration(input),
      expected,
    })
  })
}

test('parseDuration - throws on invalid format', () => {
  let threw = false
  try {
    parseDuration('invalid')
  } catch {
    threw = true
  }
  assert({
    given: 'invalid duration format',
    should: 'throw an error',
    actual: threw,
    expected: true,
  })
})
