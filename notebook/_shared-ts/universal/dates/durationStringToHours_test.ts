import { assert, test } from '#test'
import durationStringToHours from './durationStringToHours.ts'

const fixtures = [
  { given: 'zero hours', text: '0h', expected: 0 },
  { given: 'whole hours', text: '7h', expected: 7 },
  { given: 'single decimal', text: '7.5h', expected: 7.5 },
  { given: 'two decimals', text: '7.25h', expected: 7.25 },
  { given: 'exactly one day', text: '1d', expected: 24 },
  { given: 'day + whole hours', text: '1d 12h', expected: 36 },
  { given: 'day + fractional hours', text: '1d 12.23h', expected: 36.23 },
  { given: 'hours then days', text: '12h 1d', expected: 36 },
  { given: 'large days', text: '10d 0.5h', expected: 240.5 },
  { given: 'exact multiple of 24 h', text: '24h', expected: 24 },
  { given: '365 days', text: '365d', expected: 8760 },
  { given: '365d 0h form', text: '365d 0h', expected: 8760 },
  { given: 'mixed upper‑case', text: '2D 3.5H', expected: 51.5 },
  { given: 'fractional days', text: '1.5d', expected: 36 },
  { given: 'decimal days only', text: '0.5d', expected: 12 },
  { given: 'decimal precision test', text: '0.1h', expected: 0.1 },
]

fixtures.forEach(({ given, text, expected }) => {
  test(`${durationStringToHours.name} – ${given}`, () => {
    const actual = durationStringToHours(text)
    assert({
      given,
      should: `parse "${text}" to ${expected}`,
      actual,
      expected,
    })
  })
})

const invalids = [
  { given: 'empty string', text: '' },
  { given: 'no units', text: 'foo' },
  { given: 'missing number before d', text: 'd 5h' },
  { given: 'missing number before h', text: '5d h' },
  { given: 'unknown unit', text: '5x' },
  { given: 'negative hours', text: '-1h' },
  { given: 'double dot hours', text: '1.2.3h' },
  { given: 'NaN in string', text: 'NaNd' },
]

invalids.forEach(({ given, text }) => {
  test(`${durationStringToHours.name} – throws on ${given}`, () => {
    assert({
      given,
      should: 'throw RangeError',
      actual: (() => {
        try {
          durationStringToHours(text)
          return 'no error'
        } catch (e) {
          return e instanceof RangeError ? 'RangeError' : 'other error'
        }
      })(),
      expected: 'RangeError',
    })
  })
})
