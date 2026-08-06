import { assert, test } from '#test'
import { editWindow } from './browserSuggestions.ts'

test('editWindow', () => {
  assert({
    given: 'a word swap inside shared context',
    should: 'trim the shared prefix and suffix down to the word',
    expected: { caretAdvance: 4, selectCount: 3, typeText: 'dog' },
    actual: editWindow('the cat sat', 'the dog sat'),
  })

  assert({
    given: 'a pure insertion (replacement contains the whole anchor)',
    should: 'select nothing and type only the new text',
    expected: { caretAdvance: 6, selectCount: 0, typeText: 'new ' },
    actual: editWindow('alpha beta', 'alpha new beta'),
  })

  assert({
    given: 'an empty replacement',
    should: 'select the whole anchor and type nothing',
    expected: { caretAdvance: 0, selectCount: 11, typeText: '' },
    actual: editWindow('hello world', ''),
  })

  assert({
    given: 'text appended after the anchor',
    should: 'advance past the whole anchor',
    expected: { caretAdvance: 5, selectCount: 0, typeText: '!' },
    actual: editWindow('Hello', 'Hello!'),
  })

  assert({
    given: 'overlapping repeats',
    should: 'never count the same characters as both prefix and suffix',
    expected: { caretAdvance: 2, selectCount: 1, typeText: '' },
    actual: editWindow('aaa', 'aa'),
  })
})
