import { assert, test } from '#test'
import { misheardCorrections, toPersonMatches } from './misheardNames.ts'

const TRANSCRIPT = [
  'Tanesha said the renewal is on track, and Tanesha wants the draft by Friday.',
  "I told Niles Novack we'd call Novack back once Tanesha's numbers land.",
  'Sam Rivera joined late.',
].join('\n')

test('toPersonMatches()', () => {
  assert({
    given: 'the shape before the misheard list existed — bare names',
    should: 'carry each name with nothing misheard',
    actual: toPersonMatches(['Tanisha Patel', ' Sam Rivera ']),
    expected: [
      { name: 'Tanisha Patel', misheard: [] },
      { name: 'Sam Rivera', misheard: [] },
    ],
  })

  assert({
    given: 'objects with misspellings, padded, duplicated by case, and one carrying a comma',
    should: 'trim, dedupe, strip the punctuation, and drop the blank name',
    actual: toPersonMatches([
      { name: 'Tanisha Patel', misheard: [' Tanesha ', 'tanesha', 'Tanesha,'] },
      { name: '  ', misheard: ['Nobody'] },
      { name: 'Nils Novak', misheard: null },
    ]),
    expected: [
      { name: 'Tanisha Patel', misheard: ['Tanesha'] },
      { name: 'Nils Novak', misheard: [] },
    ],
  })
})

test('misheardCorrections() — where a spelling lands', () => {
  assert({
    given: 'a one-word mishearing of a first name',
    should: 'correct it to the first name alone, counting every instance including the possessive',
    actual: misheardCorrections([{ name: 'Tanisha Patel', misheard: ['Tanesha'] }], TRANSCRIPT),
    expected: [{ originalText: 'Tanesha', suggestedFix: 'Tanisha', person: 'Tanisha Patel', occurrences: 3 }],
  })

  assert({
    given: 'a one-word mishearing of a surname',
    should: 'land on the surname token, not the first name',
    actual: misheardCorrections([{ name: 'Nils Novak', misheard: ['Novack'] }], TRANSCRIPT),
    expected: [{ originalText: 'Novack', suggestedFix: 'Novak', person: 'Nils Novak', occurrences: 2 }],
  })

  assert({
    given: 'a mishearing of more than one word',
    should: 'become the full contact name',
    actual: misheardCorrections([{ name: 'Nils Novak', misheard: ['Niles Novack'] }], TRANSCRIPT),
    expected: [{ originalText: 'Niles Novack', suggestedFix: 'Nils Novak', person: 'Nils Novak', occurrences: 1 }],
  })
})

test('misheardCorrections() — what is left alone', () => {
  assert({
    given: 'a spelling an issue already covers',
    should: 'leave the term to its issue',
    actual: misheardCorrections([{ name: 'Tanisha Patel', misheard: ['Tanesha'] }], TRANSCRIPT, ['tanesha']),
    expected: [],
  })

  assert({
    given: "the contact's own token, and the token in another case",
    should: 'correct nothing',
    actual: misheardCorrections([{ name: 'Sam Rivera', misheard: ['Rivera', 'sam'] }], TRANSCRIPT),
    expected: [],
  })

  assert({
    given: 'a spelling under the replacer minimum, and one the transcript does not contain',
    should: 'skip both',
    actual: misheardCorrections([{ name: 'Tanisha Patel', misheard: ['Ta', 'Tanysha'] }], TRANSCRIPT),
    expected: [],
  })

  assert({
    given: 'a contact named by a handle',
    should: 'have no token to land on',
    actual: misheardCorrections([{ name: 'atlas/tanisha', misheard: ['Tanesha'] }], TRANSCRIPT),
    expected: [],
  })

  assert({
    given: 'the same spelling listed under two people',
    should: 'correct it once, for the first',
    actual: misheardCorrections(
      [
        { name: 'Tanisha Patel', misheard: ['Tanesha'] },
        { name: 'Tanisha Rao', misheard: ['Tanesha'] },
      ],
      TRANSCRIPT,
    ).map((c) => c.person),
    expected: ['Tanisha Patel'],
  })
})
