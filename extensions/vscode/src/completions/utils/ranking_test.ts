import { assert as assertEqual } from '#shared/test/riteway.ts'
import { scoreSortText } from './ranking.ts'

test('scoreSortText', () => {
  const fixtures = [
    {
      given: 'an unscored item',
      score: 0,
      expected: '999999',
      should: 'sort last',
    },
    {
      given: 'a negative score',
      score: -12,
      expected: '999999',
      should: 'clamp to the unscored key rather than sorting past it',
    },
    {
      given: 'a small score',
      score: 5,
      expected: '999949',
      should: 'sort ahead of the unscored',
    },
    {
      given: 'a large score',
      score: 200,
      expected: '997999',
      should: 'sort ahead of smaller scores',
    },
    {
      given: 'a score at the representable ceiling',
      score: 99_999.9,
      expected: '000000',
      should: 'sort first',
    },
    {
      given: 'a score past the ceiling',
      score: 5_000_000,
      expected: '000000',
      should: 'clamp rather than overflow into a longer, badly-sorting key',
    },
    {
      given: 'two scores differing below the displayed precision',
      score: 12.34,
      expected: scoreSortText(12.344),
      should: 'tie, matching the one decimal place the Score detail shows',
    },
  ]

  for (const { given, score, expected, should } of fixtures) {
    assertEqual({ given, should, actual: scoreSortText(score), expected })
  }
})

test('scoreSortText - orders a mixed list by score descending', () => {
  const entries = [
    { name: 'unscored', score: 0 },
    { name: 'middling', score: 20.5 },
    { name: 'top', score: 246.9 },
    { name: 'barely', score: 0.4 },
  ]

  assertEqual({
    given: 'entries sorted by their keys',
    should: 'come out in score-descending order',
    actual: entries
      .toSorted((a, b) => scoreSortText(a.score).localeCompare(scoreSortText(b.score)))
      .map((entry) => entry.name),
    expected: ['top', 'middling', 'barely', 'unscored'],
  })

  assertEqual({
    given: 'any score',
    should: 'always produce a six-character key, so keys compare positionally',
    actual: entries.map((entry) => scoreSortText(entry.score).length),
    expected: [6, 6, 6, 6],
  })
})
