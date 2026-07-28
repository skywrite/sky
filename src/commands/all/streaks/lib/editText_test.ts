import { assert, test } from '#test'
import { stripEmbeddedComments } from './editText.ts'

test(`stripEmbeddedComments() removes a comment's whole line slot`, () => {
  const text = ['**The plate**', '<!-- delete me -->', '', '- Meat', '- Vegetables'].join('\n')

  assert({
    given: 'a comment on its own line inside a list',
    should: 'remove it without leaving a blank line',
    expected: ['**The plate**', '', '- Meat', '- Vegetables'].join('\n'),
    actual: stripEmbeddedComments(text),
  })
})

test(`stripEmbeddedComments() removes a multi-line seed comment`, () => {
  const text = ['<!-- Detailed rules for this streak.', '     Delete this comment. -->', '', 'My rules'].join('\n')

  assert({
    given: 'an untouched multi-line seed comment',
    should: 'leave only the content',
    expected: 'My rules',
    actual: stripEmbeddedComments(text),
  })
})

test(`stripEmbeddedComments() passes comment-free text through`, () => {
  assert({
    given: 'text with no comments',
    should: 'return it trimmed and otherwise unchanged',
    expected: '**Rules**\n\n- One',
    actual: stripEmbeddedComments('**Rules**\n\n- One\n'),
  })
})
