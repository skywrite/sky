import { assert, test } from '#test'
import formatNameList from './formatNameList.ts'

test('formatNameList: single name', () => {
  assert({
    given: 'one name',
    should: 'return just the name',
    actual: formatNameList(['Alice']),
    expected: 'Alice',
  })
})

test('formatNameList: two names', () => {
  assert({
    given: 'two names',
    should: 'join with "and"',
    actual: formatNameList(['Alice', 'Bob']),
    expected: 'Alice and Bob',
  })
})

test('formatNameList: three names', () => {
  assert({
    given: 'three names',
    should: 'use Oxford comma',
    actual: formatNameList(['Alice', 'Bob', 'Charlie']),
    expected: 'Alice, Bob, and Charlie',
  })
})
