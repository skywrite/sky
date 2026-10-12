import { assert, test } from '#test'
import { chatAboutMessage } from './explorer.tsx'

test({ name: 'explorer - a chat about a file opens with its link and room for the question' }, () => {
  assert({
    given: 'a document with a title',
    should: 'link its page under the title, then leave an empty paragraph to type into',
    actual: chatAboutMessage('projects/open/Atlas/overview.md', 'Atlas: where it stands'),
    expected: 'About [Atlas: where it stands](/explorer/projects/open/Atlas/overview.md)\n\n',
  })
})

test({ name: 'explorer - a document without a title is named by its file' }, () => {
  assert({
    given: 'no title, or one that is only whitespace',
    should: 'use the file name without its extension',
    actual: [
      chatAboutMessage('projects/open/Atlas/overview.md'),
      chatAboutMessage('projects/open/Atlas/overview.md', ' '),
    ],
    expected: [
      'About [overview](/explorer/projects/open/Atlas/overview.md)\n\n',
      'About [overview](/explorer/projects/open/Atlas/overview.md)\n\n',
    ],
  })
})

test({ name: 'explorer - a name that looks like link syntax stays one working link' }, () => {
  assert({
    given: 'a file name with brackets, parentheses and a space',
    should: 'escape the brackets in the label and encode the parentheses and space in the address',
    actual: chatAboutMessage('library/Widget [v2] (draft).md'),
    expected: 'About [Widget \\[v2\\] (draft)](/explorer/library/Widget%20%5Bv2%5D%20%28draft%29.md)\n\n',
  })
})
