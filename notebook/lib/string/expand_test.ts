import { assert, test } from '#test'
import expand from './expand.ts'

test(expand.name, () => {
  assert({
    given: 'character + length',
    should: 'return a string of length of only the character',
    expected: '#####',
    actual: expand('#', 5),
  })

  assert({
    given: 'multiple character string + length',
    should: 'return a string of length of multiple character string * length',
    expected: '121212',
    actual: expand('12', 3),
  })

  assert({
    given: 'empty string',
    should: 'return empty string',
    expected: '',
    actual: expand('', 3023),
  })
})
