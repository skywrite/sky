import { assert, test } from '#test'
import ordinal from './ordinal.ts'

const fixture: [number, string][] = [
  [0, '0th'],
  [1, '1st'],
  [2, '2nd'],
  [3, '3rd'],
  [4, '4th'],
  [12, '12th'],
  [101, '101st'],
]

test(ordinal.name, () => {
  const given = 'a number'
  const should = 'return string value'

  fixture.forEach(([input, expected]) => {
    const actual = ordinal(input)
    assert({ given, should, actual, expected })
  })
})
