import { assert, test } from '#test'
import stripPunctuation from './stripPunctuation.ts'

test(stripPunctuation.name, () => {
  assert({
    given: 'A statement with punctuation',
    should: 'remove the punctuation',
    actual: stripPunctuation('Bob, Steve, & Andy'),
    expected: 'Bob Steve Andy',
  })
})

test(stripPunctuation.name, () => {
  assert({
    given: 'A statement with a number',
    should: 'do not remove the number',
    actual: stripPunctuation('Bob, Steve, & Andy were 3 best friends.'),
    expected: 'Bob Steve Andy were 3 best friends',
  })
})
