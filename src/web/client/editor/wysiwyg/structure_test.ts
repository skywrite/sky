import { assert, test } from '#test'
import { parseDocument, previewMarker, reparseBlock } from './parser.ts'
import { caretAfterReparse } from './structure.ts'

test('TYP-14 TYP-16 TYP-18 a paragraph previews the block its first line would become', () => {
  const cases: Array<[string, ReturnType<typeof previewMarker>]> = [
    ['## Title', { looksLike: 'h2', marker: '## ' }],
    ['#tag', null],
    ['```js\ncode', { looksLike: 'fence', marker: '```' }],
    ['``` a ` b', null],
    ['---', { looksLike: 'hr', marker: '---' }],
    ['--- not a rule', null],
    ['[atlas]: https://example.com', { looksLike: 'definition', marker: '[atlas]:' }],
    ['| a | b |\n|---|---|', { looksLike: 'table', marker: '' }],
    ['Title\n===', { looksLike: 'h1', marker: '' }],
    ['Title\n---', { looksLike: 'h2', marker: '' }],
    ['<div>', { looksLike: 'html', marker: '' }],
    ['plain', null],
  ]
  assert({
    given: 'first lines that look like headings, fences, rules, definitions, tables, html and plain text',
    should: 'name the type and the marker to mute',
    actual: cases.map(([text]) => previewMarker(text)),
    expected: cases.map(([, expected]) => expected),
  })
})

test('§8.2 the caret follows its line into the blocks a re-parse produced', () => {
  const doc = parseDocument('x\n')
  const paragraph = doc.blocks[0]!
  paragraph.text = '## Title\n\n- item one\n- item two'
  const nodes = reparseBlock(doc, paragraph)!
  const at = (offset: number) => {
    const t = caretAfterReparse(paragraph.text, offset, nodes)
    return [t.leaf.type, t.leaf.text, t.bookmark?.start]
  }
  assert({
    given: 'a caret after the heading marker, inside the heading text, and inside the second item',
    should: 'land in the heading minus its marker, and in the item paragraph minus its bullet',
    actual: [at(3), at(8), at(24), at(10)],
    expected: [
      ['heading', 'Title', 0],
      ['heading', 'Title', 5],
      ['paragraph', 'item two', 1],
      ['paragraph', 'item one', 0],
    ],
  })
})
