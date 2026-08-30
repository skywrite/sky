import { assert, test } from '#test'
import { setHeading, toggleList, toggleQuote } from './commands.ts'
import type { MarkdownDocument, Node } from './model.ts'
import { parseDocument } from './parser.ts'
import { serializeDocument } from './serializer.ts'
import { clearFormatting, shouldPair, STYLES, toggleStyle, wordAt } from './style.ts'

function leaf(doc: MarkdownDocument, index: number): Node {
  const leaves = [...doc.root.walk()].filter((node) => node.isLeaf() && node.type !== 'hr')
  return leaves[index]!
}

test('FMT-1 FMT-2 FMT-3 a style wraps a selection or a word, inserts an empty pair, and strips itself when active', () => {
  const cases = [
    toggleStyle('make bold text', 5, 9, STYLES.strong),
    toggleStyle('make **bold** text', 7, 11, STYLES.strong),
    toggleStyle('make **bold** text', 8, 8, STYLES.strong),
    toggleStyle('a word here', 3, 3, STYLES.em),
    toggleStyle('a  b', 2, 2, STYLES.strong),
    toggleStyle('  spaced  ', 0, 10, STYLES.code),
    toggleStyle('line one\nline two', 0, 17, STYLES.strong),
    toggleStyle('x `code` y', 3, 7, STYLES.code),
    toggleStyle('see [it](u) now', 5, 7, STYLES.link),
    toggleStyle('pic ![alt](s) end', 4, 13, STYLES.image),
  ]
  assert({
    given: 'selections, carets in words, carets at boundaries, padded and multi-line selections, and active constructs',
    should: 'wrap, unwrap, insert pairs, trim whitespace, wrap each line, and strip links to text and images to alt',
    actual: cases.map((c) => [c.text, c.start, c.end]),
    expected: [
      ['make **bold** text', 7, 11],
      ['make bold text', 5, 9],
      ['make bold text', 6, 6],
      ['a *word* here', 3, 7],
      ['a **** b', 4, 4],
      ['  `spaced`  ', 3, 9],
      ['**line one**\n**line two**', 2, 23],
      ['x code y', 2, 6],
      ['see it now', 4, 6],
      ['pic alt end', 4, 7],
    ],
  })
})

test('FMT-4 links take the clipboard URL, or leave the caret in the parentheses', () => {
  assert({
    given: 'a selection with and without a URL, and no selection',
    should:
      'write [sel](url) selecting the text, [sel]() with the caret inside the parentheses, and []() with the caret inside the brackets',
    actual: [
      toggleStyle('go home now', 3, 7, STYLES.link, {}, 'https://example.com'),
      toggleStyle('go home now', 3, 7, STYLES.link),
      toggleStyle('go now', 3, 3, STYLES.link),
    ],
    expected: [
      { text: 'go [home](https://example.com) now', start: 4, end: 8 },
      { text: 'go [home]() now', start: 10, end: 10 },
      { text: 'go []()now', start: 4, end: 4 },
    ],
  })
})

test('FMT-5 clearing keeps the words and drops every marker', () => {
  assert({
    given: 'text with strong, em, a link, an image and an escape',
    should: 'leave plain words',
    actual: [clearFormatting('**a** *b* [c](d) ![e](f) \\*g'), wordAt("it's here", 2)],
    expected: ['a b c e *g', [0, 4]],
  })
})

test('TYP-19 TYP-20 whether a typed opener gets its partner', () => {
  const cases: Array<[string, string, number, boolean]> = [
    ['(', 'a ', 2, true],
    ['(', 'a b', 2, false],
    ['[', '\\', 1, false],
    ['"', 'say ', 4, true],
    ['"', 'word', 4, false],
    ['"', 'say "hi', 7, false],
    ['*', 'a ', 2, true],
    ['*', 'in', 2, false],
    ['*', 'a *b', 4, false],
    ['`', 'a ``', 4, false],
    ['`', 'a ', 2, true],
    ['*', 'a `x ', 5, false],
    ['(', 'a (', 3, true],
  ]
  assert({
    given:
      'openers before spaces, letters, after backslashes, quotes after words or open quotes, markers at and inside words, inside code',
    should: 'pair only where the spec allows',
    actual: cases.map(([ch, text, at]) => shouldPair(ch, text, at)),
    expected: cases.map(([, , , expected]) => expected),
  })
})

test('FMT-7 headings by level, back to paragraph, and only the caret line of a multi-line paragraph', () => {
  const run = (source: string, index: number, depth: number | null, caret: number) => {
    const doc = parseDocument(source)
    const landing = setHeading(doc, leaf(doc, index), depth, caret)
    return [serializeDocument(doc), landing?.leaf.type, landing?.offset]
  }
  assert({
    given:
      'a paragraph made h2, an h2 made h2 again, an h3 made paragraph, and the second line of a three-line paragraph made h1',
    should: 'set the level, drop it, drop it, and split the paragraph around the heading',
    actual: [run('text\n', 0, 2, 2), run('## text\n', 0, 2, 2), run('### t\n', 0, null, 1), run('a\nbb\nc\n', 0, 1, 3)],
    expected: [
      ['## text\n', 'heading', 2],
      ['text\n', 'paragraph', 2],
      ['t\n', 'paragraph', 1],
      ['a\n\n# bb\n\nc\n', 'heading', 1],
    ],
  })
})

test('FMT-9 FMT-10 quote and list toggles wrap, unwrap, and rewrite', () => {
  const run = (source: string, indexes: number[], op: (doc: MarkdownDocument, leaves: Node[]) => boolean) => {
    const doc = parseDocument(source)
    const leaves = indexes.map((i) => leaf(doc, i))
    return [op(doc, leaves), serializeDocument(doc)]
  }
  assert({
    given:
      'quote on/off, bullets from a two-line paragraph, bullets off, bullets to numbers, numbers to tasks, tasks off',
    should: 'wrap and unwrap the quote, make an item per line, unwrap items, renumber, add boxes, and unwrap',
    actual: [
      run('a\n\nb\n', [0, 1], toggleQuote),
      run('> a\n>\n> b\n', [0], toggleQuote),
      run('one\ntwo\n', [0], (doc, leaves) => toggleList(doc, leaves, 'ul') !== null),
      run('- a\n- b\n- c\n', [1], (doc, leaves) => toggleList(doc, leaves, 'ul') !== null),
      run('- a\n- b\n', [0, 1], (doc, leaves) => toggleList(doc, leaves, 'ol') !== null),
      run('1. a\n2. b\n', [0], (doc, leaves) => toggleList(doc, leaves, 'task') !== null),
      run('- [ ] a\n- [x] b\n', [0, 1], (doc, leaves) => toggleList(doc, leaves, 'task') !== null),
    ],
    expected: [
      [true, '> a\n>\n> b\n'],
      [true, 'a\n\nb\n'],
      [true, '- one\n- two\n'],
      [true, '- a\n\nb\n\n- c\n'],
      [true, '1. a\n2. b\n'],
      [true, '1. [ ] a\n2. [ ] b\n'],
      [true, 'a\n\nb\n'],
    ],
  })
})
