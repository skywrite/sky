import { assert, loadFixturesSync, test } from '#test'
import { parseDocument } from './parser.ts'
import { displayWidth, escapePipes, serializeDocument, serializeNode } from './serializer.ts'

const FIXTURES = loadFixturesSync(import.meta.url)

test('RT-4 editing one block changes only that block on save', () => {
  const source = FIXTURES['lists-nested.md']!
  const doc = parseDocument(source)
  const heading = doc.blocks[0]!
  heading.text = 'Lists, revised'
  assert({
    given: 'a heading retitled in a file full of lists',
    should: 'save the file with only the heading line changed',
    actual: serializeDocument(doc),
    expected: source.replace('# Lists\n', '# Lists, revised\n'),
  })
})

test('LST-1 numbered lists renumber where the editor cleared markers; fixed lists keep their number', () => {
  const doc = parseDocument('1. a\n2. b\n3. c\n')
  const list = doc.blocks[0]!
  const [a, b, c] = list.children
  doc.removeNode(b!)
  c!.markerText = undefined
  const fixed = parseDocument('1. a\n1. b\n1. c\n')
  const fixedList = fixed.blocks[0]!
  fixedList.children[1]!.detach()
  const inserted = parseDocument('1. a\n2. b\n')
  const insertedList = inserted.blocks[0]!
  const item = inserted.createNode('list_item', { checked: null })
  item.appendChild(inserted.createNode('paragraph', { text: 'new' }))
  insertedList.firstChild!.addAfter(item)
  insertedList.lastChild!.markerText = undefined
  assert({
    given: 'an item removed, a fixed-numbered list shortened, and an item inserted',
    should: 'renumber the items after the change and keep 1. throughout the fixed list',
    actual: [serializeDocument(doc), serializeDocument(fixed), serializeDocument(inserted), a!.markerText],
    expected: ['1. a\n2. c\n', '1. a\n1. c\n', '1. a\n2. new\n3. b\n', '1.'],
  })
})

test('LST-2 / LST-4 new items take the list bullet and the list spacing', () => {
  const tight = parseDocument('* a\n* b\n')
  const loose = parseDocument('- a\n\n- b\n')
  for (const doc of [tight, loose]) {
    const item = doc.createNode('list_item', { checked: null })
    item.appendChild(doc.createNode('paragraph', { text: 'c' }))
    doc.blocks[0]!.appendChild(item)
  }
  assert({
    given: 'an item appended to a tight star list and to a loose dash list',
    should: 'use the list bullet, no blank line in the tight list and one in the loose list',
    actual: [serializeDocument(tight), serializeDocument(loose)],
    expected: ['* a\n* b\n* c\n', '- a\n\n- b\n\n- c\n'],
  })
})

test('LST-5 two adjacent lists are separated by a blank line', () => {
  const doc = parseDocument('- a\n')
  const second = doc.createNode('list', { style: 'ul', bullet: '-', loose: false })
  const item = doc.createNode('list_item', { checked: null })
  item.appendChild(doc.createNode('paragraph', { text: 'b' }))
  second.appendChild(item)
  doc.root.appendChild(second)
  assert({
    given: 'a second dash list placed right after the first',
    should: 'keep a blank line between them',
    actual: serializeDocument(doc),
    expected: '- a\n\n- b\n',
  })
})

test('LST-3 task state is written as [x] / [ ], keeping the original mark when unchanged', () => {
  const doc = parseDocument('- [ ] open\n- [X] shouting\n- plain\n')
  const [open, shouting, plain] = doc.blocks[0]!.children
  open!.checked = true
  plain!.checked = false
  assert({
    given: 'an open task checked, a [X] task left alone, a plain item made a task',
    should: 'swap the first mark, keep [X], and add [ ] to the plain item',
    actual: serializeDocument(doc),
    expected: '- [x] open\n- [X] shouting\n- [ ] plain\n',
  })
})

test('RT-5 an item whose lines changed is re-indented from its own indent', () => {
  const doc = parseDocument('1. first\n   second line\n')
  doc.blocks[0]!.firstChild!.firstChild!.text = 'first\nsecond line\nthird line'
  assert({
    given: 'a third line added to a numbered item',
    should: 'indent the new continuation line to the content column',
    actual: serializeDocument(doc),
    expected: '1. first\n   second line\n   third line\n',
  })
})

test('RT-1 quotes regenerate their prefix when their line count changed', () => {
  const doc = parseDocument('> a\n> b\n')
  doc.blocks[0]!.firstChild!.text = 'a\nb\nc'
  assert({
    given: 'a line added inside a quote',
    should: 'prefix every line with > ',
    actual: serializeDocument(doc),
    expected: '> a\n> b\n> c\n',
  })
})

test('RT-8 a fence grows its marker past any closing run in its code', () => {
  const doc = parseDocument('```\ncode\n```\n')
  doc.blocks[0]!.text = 'code\n```\nmore'
  const fresh = parseDocument('x\n')
  const fence = fresh.createNode('fence', { lang: 'js', text: 'let a = 1' })
  fresh.root.appendChild(fence)
  assert({
    given: 'a fence whose body gains a ``` line, and a fence created by the editor',
    should: 'lengthen the markers to four, and default to ``` with the language',
    actual: [serializeDocument(doc), serializeDocument(fresh)],
    expected: ['````\ncode\n```\nmore\n````\n', 'x\n\n```js\nlet a = 1\n```\n'],
  })
})

test('RT-6 a table is verbatim until edited, then re-padded with its alignment', () => {
  const source = '| Name | Score |\n|:--|--:|\n| Atlas | 10 |\n'
  const untouched = parseDocument(source)
  const edited = parseDocument(source)
  const table = edited.blocks[0]!
  table.userText = undefined
  table.children[1]!.children[0]!.text = 'Jane Doe'
  assert({
    given: 'the same table untouched and with one cell edited',
    should: 'save the original bytes, then rebuild aligned columns',
    actual: [serializeDocument(untouched), serializeDocument(edited)],
    expected: [source, '| Name     | Score |\n| :------- | ----: |\n| Jane Doe |    10 |\n'],
  })
})

test('TBL-1 pipes typed into a cell are escaped on save, but not inside code', () => {
  assert({
    given: 'cell text with a bare pipe, an escaped pipe and a code span holding a pipe',
    should: 'escape only the bare pipe',
    actual: escapePipes('a | b \\| `c | d`'),
    expected: 'a \\| b \\| `c | d`',
  })
})

test('RT-6 column widths are display-width aware', () => {
  assert({
    given: 'ASCII, CJK and emoji text',
    should: 'count wide characters twice',
    actual: [displayWidth('abc'), displayWidth('日本語'), displayWidth('a😀')],
    expected: [3, 6, 3],
  })
})

test('RT-7 headings and rules created by the editor use the default spelling', () => {
  const doc = parseDocument('x\n')
  doc.root.appendChild(doc.createNode('heading', { depth: 3, text: 'New' }))
  doc.root.appendChild(doc.createNode('hr'))
  doc.root.appendChild(doc.createNode('definition', { ref: 'atlas', href: 'https://example.com', title: 'Atlas' }))
  assert({
    given: 'a heading, a rule and a definition with no recorded pattern',
    should: 'write ### , --- and [ref]: url "title"',
    actual: doc.blocks.slice(1).map((node) => serializeNode(node)),
    expected: [['### New'], ['---'], ['[atlas]: https://example.com "Atlas"']],
  })
})
