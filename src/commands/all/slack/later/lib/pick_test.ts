import { assert, test } from '#test'
import { oneLine, parseSelection } from './pick.ts'

test('parseSelection: all, indexes, and rejects', () => {
  assert({ given: 'all', should: 'pass through', actual: parseSelection('ALL', 5), expected: 'all' })
  assert({
    given: '1-based list',
    should: 'become 0-based deduped',
    actual: parseSelection('1, 3,3', 5),
    expected: [0, 2],
  })
  assert({ given: 'an out-of-range index', should: 'reject', actual: parseSelection('6', 5), expected: undefined })
  assert({ given: 'garbage', should: 'reject', actual: parseSelection('x,y', 5), expected: undefined })
})

test('oneLine collapses and caps', () => {
  assert({
    given: 'a multi-line body',
    should: 'collapse whitespace',
    actual: oneLine('a\n  b\tc', 20),
    expected: 'a b c',
  })
  assert({ given: 'a long line', should: 'cap with ellipsis', actual: oneLine('abcdefghij', 5), expected: 'abcd…' })
})
