import { assert, test } from '#test'
import prefixZero from './prefixZero.ts'

test(prefixZero.name, () => {
  const given = 'an index and count'
  const should = 'resolve the string with 0 prefix'

  let actual = prefixZero(3, 9)
  let expected = '3'
  assert({ actual, expected, given, should })

  actual = prefixZero(3, 99)
  expected = '03'
  assert({ actual, expected, given, should })

  actual = prefixZero(3, 999)
  expected = '003'
  assert({ actual, expected, given, should })

  actual = prefixZero(3, 1000)
  expected = '0003'
  assert({ actual, expected, given, should })
})
