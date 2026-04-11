import { assert, test } from '#test'
import Duration from './mod.ts'

const fixtures = [
  { given: '1h 30m', d: new Duration(1, 30, 0), expected: 'PT1H30M' },
  { given: '0', d: new Duration(), expected: 'PT0S' },
  { given: '90 minutes', d: new Duration(0, 90, 0), expected: 'PT1H30M' },
  { given: '1h 0m 15s', d: new Duration(1, 0, 15), expected: 'PT1H15S' },
  { given: 'negative 1h', d: new Duration(-1, 0, 0), expected: '-PT1H' },
  { given: '3661 seconds', d: new Duration(0, 0, 3661), expected: 'PT1H1M1S' },
]

fixtures.forEach(({ given, d, expected }) => {
  test(`Duration.toString - ${given}`, () => {
    assert({ given, should: `be "${expected}"`, actual: d.toString(), expected })
  })
})

test('Duration.toJSON matches toString', () => {
  const d = new Duration(1, 30, 0)
  assert({ given: '1h 30m', should: 'match toString', actual: d.toJSON(), expected: d.toString() })
})
