import { assert, test } from '#test'
import hoursToDurationString from './hoursToDurationString.ts'

const fixtures = [
  { given: 'zero hours', hours: 0, expected: '0h' },
  { given: 'whole hours', hours: 7, expected: '7h' },
  { given: 'single decimal', hours: 7.5, expected: '7.5h' },
  { given: 'two decimals', hours: 7.25, expected: '7.25h' },
  { given: 'rounding to two decimals', hours: 0.015, expected: '0.02h' },
  { given: 'exactly one day', hours: 24, expected: '1d' },
  { given: 'days + whole hours', hours: 36, expected: '1d 12h' },
  { given: 'days + fractional hours', hours: 36.23, expected: '1d 12.23h' },
  { given: 'round up after precision', hours: 100.999, expected: '4d 5h' },
  { given: 'very large days', hours: 240.5, expected: '10d 0.5h' },
  { given: 'rounds to exactly 0', hours: 0.004, expected: '0h' },
  { given: 'rounds to 24 (day bump)', hours: 23.995, expected: '24h' },
  { given: 'strips .00 correctly', hours: 1.001, expected: '1h' },
  { given: 'preserves .10', hours: 5.1, expected: '5.1h' },
  { given: 'preserves .50', hours: 3.5, expected: '3.5h' },
  { given: 'floating point sum', hours: 0.1 + 0.2, expected: '0.3h' },
  { given: 'day rollover after rounding', hours: 47.995, expected: '1d 23.99h' },
  { given: 'exact multiple of 24', hours: 48, expected: '2d' },
  { given: 'rounding up fractional part', hours: 1.236, expected: '1.24h' },
  { given: 'fraction just below hour', hours: 0.995, expected: '1h' },
  { given: 'minimum non-zero rounding', hours: 0.005, expected: '0.01h' },
  { given: 'float imprecision typical', hours: 0.30000000000000004, expected: '0.3h' },
  { given: 'massive duration (~1 year)', hours: 8760, expected: '365d' },
]

fixtures.forEach(({ given, hours, expected }) => {
  test(`${hoursToDurationString.name} – ${given}`, () => {
    const actual = hoursToDurationString(hours)
    assert({
      given,
      should: `format ${hours} correctly`,
      actual,
      expected,
    })
  })
})

test(`${hoursToDurationString.name} – throws on negative`, () => {
  assert({
    given: 'negative hours',
    should: 'throw RangeError',
    actual: (() => {
      try {
        hoursToDurationString(-1)
        return 'no error'
      } catch (e) {
        return e instanceof RangeError ? 'RangeError' : 'other error'
      }
    })(),
    expected: 'RangeError',
  })
})

// invalid numeric inputs
const invalids = [
  { given: 'NaN', hours: NaN },
  { given: 'Infinity', hours: Infinity },
]

invalids.forEach(({ given, hours }) => {
  test(`${hoursToDurationString.name} – throws on ${given}`, () => {
    assert({
      given,
      should: 'throw RangeError',
      actual: (() => {
        try {
          hoursToDurationString(hours)
          return 'no error'
        } catch (e) {
          return e instanceof RangeError ? 'RangeError' : 'other error'
        }
      })(),
      expected: 'RangeError',
    })
  })
})
