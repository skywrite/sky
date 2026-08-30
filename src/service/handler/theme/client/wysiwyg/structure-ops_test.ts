import { assert, test } from '#test'
import { backspaceAtStart, deleteAcross, deleteAtEnd, widenSelection } from './delete.ts'
import { indentItem, outdentItem, unnest } from './lists.ts'
import type { MarkdownDocument, Node } from './model.ts'
import { parseDocument } from './parser.ts'
import { serializeDocument } from './serializer.ts'
import { balancedSplit, splitBlock } from './split.ts'

/** The nth text leaf of the document in document order. */
function leaf(doc: MarkdownDocument, index: number): Node {
  const leaves = [...doc.root.walk()].filter((node) => node.isLeaf() && node.type !== 'hr')
  return leaves[index]!
}

test('ENT-2 a split re-balances the pairs it cuts and drops the pairs it empties', () => {
  const cases: Array<[string, number, [string, string]]> = [
    ['**bo|ld**', 4, ['**bo**', '**ld**']],
    ['**|bold**', 2, ['', '**bold**']],
    ['**bold|**', 6, ['**bold**', '']],
    ['**a *b|c* d**', 6, ['**a *b***', '***c* d**']],
    ['`co|de`', 3, ['`co`', '`de`']],
    ['pl|ain', 2, ['pl', 'ain']],
    ['<u>a|b</u>', 4, ['<u>a</u>', '<u>b</u>']],
    ['[li|nk](u)', 3, ['[li', 'nk](u)']],
  ]
  assert({
    given: 'carets inside strong, at its edges, in nested emphasis, code, plain text, underline and a link',
    should: 'close the cut pair before the split and reopen it after',
    actual: cases.map(([text, caret]) => balancedSplit(text.replace('|', ''), caret)),
    expected: cases.map(([, , expected]) => expected),
  })
})

test('ENT-1 ENT-3 ENT-6 Enter in paragraphs and headings', () => {
  const run = (source: string, index: number, caret: number) => {
    const doc = parseDocument(source)
    const target = leaf(doc, index)
    const result = splitBlock(doc, target, caret, {})
    return [serializeDocument(doc), result.leaf.type, result.leaf.text, result.offset]
  }
  assert({
    given: 'Enter at the end, middle and start of a paragraph and of a heading',
    should:
      'give an empty paragraph after, a split, an empty block above with the caret on the text; headings split as headings',
    actual: [
      run('Hello\n', 0, 5),
      run('Hello\n', 0, 2),
      run('Hello\n', 0, 0),
      run('## Title\n', 0, 5),
      run('## Title\n', 0, 2),
      run('## Title\n', 0, 0),
    ],
    expected: [
      ['Hello\n\n\n', 'paragraph', '', 0],
      ['He\n\nllo\n', 'paragraph', 'llo', 0],
      ['\n\nHello\n', 'paragraph', 'Hello', 0],
      ['## Title\n\n\n', 'paragraph', '', 0],
      ['## Ti\n\n## tle\n', 'heading', 'tle', 0],
      ['\n\n## Title\n', 'heading', 'Title', 0],
    ],
  })
})

test('ENT-4 ENT-5 Enter commits a previewed marker in the first half', () => {
  const run = (source: string, first = false) => {
    const doc = parseDocument(first ? 'x\n' : 'x\n\ny\n')
    const target = doc.blocks[first ? 0 : 1]!
    target.text = source
    const result = splitBlock(doc, target, source.length, {})
    return [doc.blocks.map((b) => b.type), result.leaf.type, serializeDocument(doc)]
  }
  assert({
    given: 'Enter after a heading marker, a fence opener, a rule, a pipe row and a definition',
    should:
      'create the block, leave a paragraph after it, and put the caret in the fence, the table body, or the paragraph',
    actual: [
      run('## Title'),
      run('```js'),
      run('---'),
      run('| a | b |'),
      run('[atlas]: https://example.com'),
      run('---', true),
    ],
    expected: [
      [['paragraph', 'heading', 'paragraph'], 'paragraph', 'x\n\n## Title\n\n\n'],
      [['paragraph', 'fence', 'paragraph'], 'fence', 'x\n\n```js\n```\n\n\n'],
      [['paragraph', 'hr', 'paragraph'], 'paragraph', 'x\n\n---\n\n\n'],
      [['paragraph', 'table', 'paragraph'], 'table_cell', 'x\n\n| a   | b   |\n| --- | --- |\n|     |     |\n\n\n'],
      [['paragraph', 'definition', 'paragraph'], 'paragraph', 'x\n\n[atlas]: https://example.com\n\n\n'],
      [['frontmatter', 'paragraph'], 'frontmatter', '---\n---\n\n\n'],
    ],
  })
})

test('ENT-11 ENT-12 ENT-13 Enter in a list item', () => {
  const run = (source: string, index: number, caret: number) => {
    const doc = parseDocument(source)
    const result = splitBlock(doc, leaf(doc, index), caret, {})
    return [serializeDocument(doc), result.leaf.text]
  }
  assert({
    given: 'Enter at the end, middle and start of an item, on a task item, and on an item with a nested list',
    should:
      'add an item after, split into two items, insert an empty item above, start the new task unchecked, and move the nested list with the second half',
    actual: [
      run('- one\n- two\n', 0, 3),
      run('- one\n- two\n', 0, 1),
      run('- one\n- two\n', 1, 0),
      run('- [x] done\n', 0, 4),
      run('1. one\n   - sub\n2. two\n', 0, 3),
    ],
    expected: [
      ['- one\n- \n- two\n', ''],
      ['- o\n- ne\n- two\n', 'ne'],
      ['- one\n- \n- two\n', 'two'],
      ['- [x] done\n- [ ] \n', ''],
      ['1. one\n2. \n   - sub\n3. two\n', ''],
    ],
  })
})

test('ENT-14 ENT-15 ENT-16 Enter on an empty block leaves its container', () => {
  const run = (source: string, index: number) => {
    const doc = parseDocument(source)
    const result = splitBlock(doc, leaf(doc, index), 0, {})
    return [serializeDocument(doc), result.leaf.parent?.type]
  }
  const twice = parseDocument('- a\n  - b\n  -\n  - c\n')
  const inner = leaf(twice, 2)
  splitBlock(twice, inner, 0, {})
  const once = serializeDocument(twice)
  splitBlock(twice, inner, 0, {})
  const quote = parseDocument('> a\n>\n> b\n>\n> c\n')
  leaf(quote, 1).text = ''
  const lifted = splitBlock(quote, leaf(quote, 1), 0, {})
  assert({
    given:
      'an empty item among siblings, the only empty item of a list, an empty nested item (Enter twice), and an empty quote paragraph',
    should:
      'become a paragraph between the list halves, remove the lone list, land inside the parent item then become its sibling item, and lift out of the quote',
    actual: [
      run('- a\n-\n- c\n', 1),
      run('-\n', 0),
      once,
      serializeDocument(twice),
      [serializeDocument(quote), lifted.leaf.parent?.type],
    ],
    expected: [
      ['- a\n\n\n\n- c\n', 'document'],
      ['\n', 'document'],
      '- a\n  - b\n  \n  - c\n',
      '- a\n  - b\n  - c\n- \n',
      ['> a\n\n\n\n> c\n', 'document'],
    ],
  })
})

test('DEL-7 … DEL-14 Backspace at a block start follows the chain', () => {
  const run = (source: string, index: number, empty = false) => {
    const doc = parseDocument(source)
    const target = leaf(doc, index)
    if (empty) target.text = ''
    const landing = backspaceAtStart(doc, target)
    return [serializeDocument(doc), landing ? `${landing.leaf.type}@${landing.offset}` : null]
  }
  assert({
    given: 'each situation of the chain in turn',
    should:
      'delete a rule, delete an empty paragraph, drop a task box, leave a quote, leave a list, join the previous item, revert a heading and a short fence, merge into a list and a quote, remove an empty block, remove the first empty block, and do nothing for the only block',
    actual: [
      run('a\n\n---\n\nb\n', 1),
      (() => {
        const doc = parseDocument('a\n\nx\n\nb\n')
        leaf(doc, 1).text = ''
        const landing = backspaceAtStart(doc, leaf(doc, 2))
        return [serializeDocument(doc), landing ? `${landing.leaf.type}@${landing.offset}` : null]
      })(),
      run('- [ ] task\n', 0),
      run('> a\n>\n> b\n', 0),
      run('- a\n- b\n', 0),
      run('- a\n- b\n', 1),
      run('# H\n', 0),
      run('```\ncode\n```\n', 0),
      run('- a\n\nb\n', 1),
      run('> a\n\nb\n', 1),
      run('a\n\nx\n', 1, true),
      run('x\n\nb\n', 0, true),
      run('only\n', 0),
    ],
    expected: [
      ['a\n\nb\n', 'paragraph@0'],
      ['a\n\nb\n', 'paragraph@0'],
      ['- task\n', 'paragraph@0'],
      ['a\n\n> b\n', 'paragraph@0'],
      ['a\n\n- b\n', 'paragraph@0'],
      ['- a\n  b\n', 'paragraph@0'],
      ['H\n', 'paragraph@0'],
      ['code\n', 'paragraph@0'],
      ['- ab\n', 'paragraph@1'],
      ['> ab\n', 'paragraph@1'],
      ['a\n', 'paragraph@1'],
      ['b\n', 'paragraph@0'],
      ['only\n', null],
    ],
  })
})

test('DEL-15 DEL-16 Delete at a block end merges the next leaf or removes an empty block', () => {
  const run = (source: string, index: number, empty = false) => {
    const doc = parseDocument(source)
    const target = leaf(doc, index)
    if (empty) target.text = ''
    const landing = deleteAtEnd(doc, target)
    return [serializeDocument(doc), landing ? `${landing.leaf.text}@${landing.offset}` : null]
  }
  assert({
    given: 'Delete before a heading, before a rule, in an empty block, and at the document end',
    should: 'merge the heading text, remove the rule, remove the block, and do nothing',
    actual: [run('a\n\n# H\n', 0), run('a\n\n---\n\nb\n', 0), run('x\n\nb\n', 0, true), run('a\n', 0)],
    expected: [
      ['aH\n', 'aH@1'],
      ['a\n\nb\n', 'a@1'],
      ['b\n', 'b@0'],
      ['a\n', null],
    ],
  })
})

test('DEL-22 DEL-24 a selection across blocks keeps the first type and drops what is between', () => {
  const doc = parseDocument('# Head\n\n---\n\n- one\n- two\n\nlast words\n')
  const landing = deleteAcross(doc, leaf(doc, 0), 2, leaf(doc, 3), 5)
  assert({
    given: 'a selection from inside the heading to inside the last paragraph, over a rule and a list',
    should: 'leave a heading holding both ends and remove the rule and list',
    actual: [serializeDocument(doc), landing?.leaf.type, landing?.offset],
    expected: ['# Hewords\n', 'heading', 2],
  })
})

test('DEL-21 a selection touching hidden markers widens to include them', () => {
  assert({
    given: 'selections covering exactly the content of strong, code and link constructs, and one that does not',
    should: 'widen to the whole construct only when the content is fully selected',
    actual: [
      widenSelection('**bold**', 2, 6),
      widenSelection('a `x` b', 3, 4),
      widenSelection('[t](u)', 1, 2),
      widenSelection('**bold**', 2, 4),
      widenSelection('**bold** x', 2, 9),
    ],
    expected: [
      [0, 8],
      [2, 5],
      [0, 6],
      [2, 4],
      [0, 9],
    ],
  })
})

test('TAB-1 TAB-2 TAB-3 indent and outdent', () => {
  const run = (source: string, index: number, op: 'in' | 'out') => {
    const doc = parseDocument(source)
    const item = leaf(doc, index).parent!
    const changed = op === 'in' ? indentItem(doc, item) : outdentItem(doc, item)
    return [changed, serializeDocument(doc)]
  }
  assert({
    given:
      'Tab on a second item, on a first item, on an item after one with a sub-list; Shift+Tab on a nested item with followers and on a top-level item',
    should:
      'nest, ignore, join the sub-list, move after the parent taking followers as children, and unwrap into paragraphs',
    actual: [
      run('- a\n- b\n', 1, 'in'),
      run('- a\n- b\n', 0, 'in'),
      run('- a\n  - a1\n- b\n', 2, 'in'),
      run('- a\n  - b\n  - c\n- d\n', 1, 'out'),
      run('- a\n- b\n- c\n', 1, 'out'),
    ],
    expected: [
      [true, '- a\n  - b\n'],
      [false, '- a\n- b\n'],
      [true, '- a\n  - a1\n  - b\n'],
      [true, '- a\n- b\n  - c\n- d\n'],
      [true, '- a\n\nb\n\n- c\n'],
    ],
  })
})

test('TAB-8 Shift+Tab lifts a paragraph out of a quote', () => {
  const doc = parseDocument('> a\n>\n> b\n>\n> c\n')
  unnest(doc, leaf(doc, 1))
  assert({
    given: 'the middle paragraph of a quote',
    should: 'sit between two quotes',
    actual: serializeDocument(doc),
    expected: '> a\n\nb\n\n> c\n',
  })
})
