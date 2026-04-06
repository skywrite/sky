import { assert, test } from '#test'
import { formatNumber } from './formatNumber.ts'

const fixtures = [
  {
    input: 112002.10036143452,
    expected: 112002.1,
    description: 'large crypto price (BTC)',
  },
  {
    input: 3822.2127974804084,
    expected: 3822.213,
    description: 'medium crypto price (ETH)',
  },
  {
    input: 182.8098282099334,
    expected: 182.81,
    description: 'medium crypto price (SOL)',
  },
  {
    input: 1.6329906232697153,
    expected: 1.633,
    description: 'price just above 1 (ORCA)',
  },
  {
    input: 0.7156934213095666,
    expected: 0.716,
    description: 'price below 1 with 3 sig figs (FTT)',
  },
  {
    input: 0.01125934714513429,
    expected: 0.0113,
    description: 'small price with 3 sig figs (SRM)',
  },
  {
    input: 0.000037655434960555994,
    expected: 0.0000377,
    description: 'micro price with 3 sig figs (LUNA)',
  },
  {
    input: 1.0,
    expected: 1.0,
    description: 'exactly 1',
  },
  {
    input: 0.999,
    expected: 0.999,
    description: 'just below 1',
  },
  {
    input: 1.001,
    expected: 1.001,
    description: 'just above 1',
  },
  {
    input: 0.0001,
    expected: 0.0001,
    description: 'small value already 1 sig fig',
  },
  {
    input: 123456.789,
    expected: 123456.789,
    description: 'large value with many decimals',
  },
  {
    input: 0.123456789,
    expected: 0.123,
    description: 'decimal with many sig figs truncated to 3',
  },
]

fixtures.forEach((fixture) => {
  test(`formatNumber - ${fixture.description}`, () => {
    const result = formatNumber(fixture.input)

    assert({
      given: `input ${fixture.input}`,
      should: `return ${fixture.expected}`,
      actual: result,
      expected: fixture.expected,
    })
  })
})

test('formatNumber - preserves type as number', () => {
  const result = formatNumber(123.456)

  assert({
    given: 'a number input',
    should: 'return a number type',
    actual: typeof result,
    expected: 'number',
  })
})
