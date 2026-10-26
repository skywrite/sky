import { assert, test } from '#test'
import { findPattern, matchesIn, type Piece, sourceSpan } from './find.ts'

const PLAIN = { matchCase: false, wholeWord: false }

function find(text: string, query: string, options = PLAIN): string[] {
  const pattern = findPattern(query, options)
  return pattern ? matchesIn(text, pattern).map(([start, end]) => text.slice(start, end)) : []
}

test({ name: 'find - nothing to look for' }, () => {
  assert({
    given: 'an empty query, or one of only spaces',
    should: 'have no pattern',
    actual: [findPattern('', PLAIN), findPattern('   ', PLAIN)],
    expected: [null, null],
  })
})

test({ name: 'find - case, unless asked to match it' }, () => {
  assert({
    given: 'a word written three ways',
    should: 'find all three, or only the exact one when the case must match',
    actual: [
      find('Atlas, atlas, ATLAS', 'atlas'),
      find('Atlas, atlas, ATLAS', 'atlas', { matchCase: true, wholeWord: false }),
    ],
    expected: [['Atlas', 'atlas', 'ATLAS'], ['atlas']],
  })
})

test({ name: 'find - whole words, letters of any script' }, () => {
  assert({
    given: 'a word that also starts a longer one, and an accented word',
    should: 'find only the word standing alone',
    actual: [
      find('Atlas and Atlassian', 'atlas', { matchCase: false, wholeWord: true }),
      find('café, cafés', 'café', { matchCase: false, wholeWord: true }),
    ],
    expected: [['Atlas'], ['café']],
  })
})

test({ name: 'find - a space matches any run of whitespace' }, () => {
  assert({
    given: 'a phrase broken across lines, or spaced out',
    should: 'find it either way',
    actual: find('launch\nplan, launch   plan', 'launch plan'),
    expected: ['launch\nplan', 'launch   plan'],
  })
})

test({ name: 'find - the query is text, not a pattern' }, () => {
  assert({
    given: 'a query full of pattern characters',
    should: 'match those characters as written',
    actual: [find('C++ (beta) costs $5', 'c++ (beta)'), find('a.b axb', 'a.b')],
    expected: [['C++ (beta)'], ['a.b']],
  })
})

const piece = (at: number, length: number, source: number, afterEscape = false): Piece => ({
  at,
  length,
  source,
  afterEscape,
})

test({ name: 'find - a match covers the markdown under it' }, () => {
  assert({
    given: 'link text after plain text: `see [atlas](…)` reads "see atlas"',
    should: 'map the link text to its markdown, and refuse a match across the hidden bracket',
    actual: [sourceSpan([piece(0, 4, 0), piece(4, 5, 5)], 4, 9), sourceSpan([piece(0, 4, 0), piece(4, 5, 5)], 0, 9)],
    expected: [{ start: 5, end: 10 }, null],
  })
})

test({ name: 'find - formatting inside a word keeps it from matching' }, () => {
  assert({
    given: '`At**las**` read as "Atlas"',
    should: 'refuse the whole word, which a replace would break, and allow the part inside the bold',
    actual: [sourceSpan([piece(0, 2, 0), piece(2, 3, 4)], 0, 5), sourceSpan([piece(0, 2, 0), piece(2, 3, 4)], 2, 5)],
    expected: [null, { start: 4, end: 7 }],
  })
})

test({ name: 'find - an escaped character goes with its backslash' }, () => {
  const pieces = [piece(0, 1, 0), piece(1, 2, 2, true)]
  assert({
    given: '`a\\*b` read as "a*b"',
    should: 'match across the escape, and take the backslash along when the match starts on the character',
    actual: [sourceSpan(pieces, 0, 3), sourceSpan(pieces, 1, 2)],
    expected: [
      { start: 0, end: 4 },
      { start: 1, end: 3 },
    ],
  })
})
