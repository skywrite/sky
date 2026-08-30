import { assert, test } from '#test'
import oneLine from './oneLine.ts'

test('oneLine collapses and caps', () => {
  assert({
    given: 'a multi-line body',
    should: 'collapse whitespace',
    actual: oneLine('a\n  b\tc', 20),
    expected: 'a b c',
  })
  assert({ given: 'a long line', should: 'cap with ellipsis', actual: oneLine('abcdefghij', 5), expected: 'abcd…' })
})
