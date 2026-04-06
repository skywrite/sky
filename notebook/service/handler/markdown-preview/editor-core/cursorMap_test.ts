import { assert, test } from '#test'
import { buildBlockCursorMaps } from './cursorMap.ts'
import { parseEditorDocument } from './parse.ts'

test('cursor maps place heading carets inside inline markdown syntax correctly', () => {
  const document = parseEditorDocument('## Hello **world**\n')
  const heading = document.nodes.find((node) => node.type === 'heading')

  assert({
    given: 'a heading with strong markdown',
    should: 'place the cursor after the opening strong marker when clicking before the strong text',
    actual: heading ? buildBlockCursorMaps(heading).cursorMap?.[6] : undefined,
    expected: 11,
  })
})

test('cursor maps place paragraph carets inside inline links correctly', () => {
  const document = parseEditorDocument('Alpha [beta](https://example.com) gamma\n')
  const paragraph = document.nodes.find((node) => node.type === 'paragraph')

  assert({
    given: 'a paragraph with an inline link',
    should: 'place the cursor inside the link label rather than in the url suffix',
    actual: paragraph ? buildBlockCursorMaps(paragraph).cursorMap?.[10] : undefined,
    expected: 11,
  })
})

test('cursor maps place list item carets inside later list items', () => {
  const document = parseEditorDocument('- one\n- **two**\n')
  const list = document.nodes.find((node) => node.type === 'list')

  assert({
    given: 'a list with a formatted second item',
    should: 'place the cursor after the opening strong marker for the second item',
    actual: list ? buildBlockCursorMaps(list).listItemCursorMaps?.[1]?.[0] : undefined,
    expected: 10,
  })
})

test('cursor maps flatten nested list items in rendered dom order', () => {
  const document = parseEditorDocument('- parent\n  - nested\n- sibling\n')
  const list = document.nodes.find((node) => node.type === 'list')

  assert({
    given: 'a nested list',
    should: 'include the nested list item between the parent and sibling items',
    actual: list ? buildBlockCursorMaps(list).listItemCursorMaps?.length : undefined,
    expected: 3,
  })

  assert({
    given: 'a nested list',
    should: 'map the nested list item to its nested raw offset',
    actual: list ? buildBlockCursorMaps(list).listItemCursorMaps?.[1]?.[0] : undefined,
    expected: 13,
  })
})

test('cursor maps skip checkbox syntax for task list items', () => {
  const document = parseEditorDocument('- [ ] task item\n')
  const list = document.nodes.find((node) => node.type === 'list')

  assert({
    given: 'a task list item',
    should: 'place the caret after the checkbox marker rather than before it',
    actual: list ? buildBlockCursorMaps(list).listItemCursorMaps?.[0]?.[0] : undefined,
    expected: 6,
  })
})
