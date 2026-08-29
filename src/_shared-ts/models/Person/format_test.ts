import { assert, test } from '#test'
import { lineKey, MAX_WORDS_PER_LINE, overCap, toFactLines, wordCount } from './format.ts'

test('toFactLines - chained clauses and sentences become one line per fact', () => {
  assert({
    given: 'a semicolon chain and a two-sentence line',
    should: 'split on the semicolon and the sentence end, capitalizing a cut piece unless it is a brand',
    actual: toFactLines('Runs the vendor program; reports to the platform lead. Joined Atlas in 2024; iPhone user.'),
    expected: ['Runs the vendor program', 'Reports to the platform lead.', 'Joined Atlas in 2024', 'iPhone user.'],
  })
})

test('toFactLines - abbreviations, initials, and dotted forms never split', () => {
  assert({
    given: 'periods that do not end a sentence',
    should: 'split only at the real sentence end',
    actual: toFactLines(
      'Met Dr. Quinn and J. Park in St. Louis. Served in the U.S. Army for four years. Now at Atlas.',
    ),
    expected: ['Met Dr. Quinn and J. Park in St. Louis.', 'Served in the U.S. Army for four years.', 'Now at Atlas.'],
  })
})

test('toFactLines - headings, heading echoes, list markers, and blank lines drop', () => {
  assert({
    given: 'model output carrying a heading, an echo of the section name, and bullets',
    should: 'keep only the facts, unbulleted',
    actual: toFactLines(['## Overview', 'Overview', '', '- Platform lead at Example Corp.', '1. Met via Atlas.']),
    expected: ['Platform lead at Example Corp.', 'Met via Atlas.'],
  })
})

test('wordCount / overCap - the cap is counted on whitespace', () => {
  const fits = Array.from({ length: MAX_WORDS_PER_LINE }, (_, i) => `w${i}`).join(' ')
  const over = `${fits} extra`
  assert({
    given: 'a line at the cap and one word past it',
    should: 'count words and name the first line over the cap',
    actual: { fits: wordCount(fits), over: wordCount(over), first: overCap([fits, over]) },
    expected: { fits: MAX_WORDS_PER_LINE, over: MAX_WORDS_PER_LINE + 1, first: over },
  })
})

test('lineKey - marker, case, and terminal period do not distinguish lines', () => {
  assert({
    given: 'the same fact as a bullet, bare, and with a period',
    should: 'produce one key',
    actual: new Set([lineKey('- Partner: Jordan.'), lineKey('partner: jordan'), lineKey('  Partner: Jordan  ')]).size,
    expected: 1,
  })
})
