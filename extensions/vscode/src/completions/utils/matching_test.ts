import { assert as assertEqual } from '#shared/test/riteway.ts'
import { filterByPrefix } from './matching.ts'

/**
 * filterByPrefix is the shared filter behind the org, attachment, timezone and
 * day-item completions. It is a *prefix* filter, not a fuzzy or substring one —
 * these fixtures pin that, since the difference is invisible until someone
 * types a middle-of-the-name fragment and gets nothing back.
 */
test('filterByPrefix', () => {
  const fixtures = [
    {
      given: 'an empty prefix',
      items: ['Atlas', 'Acme', 'Borealis'],
      prefix: '',
      expected: ['Atlas', 'Acme', 'Borealis'],
      should: 'return every item',
    },
    {
      given: 'a lowercase prefix and capitalized items',
      items: ['Atlas', 'Acme', 'Borealis'],
      prefix: 'a',
      expected: ['Atlas', 'Acme'],
      should: 'match case-insensitively',
    },
    {
      given: 'an uppercase prefix and capitalized items',
      items: ['Atlas', 'Acme', 'Borealis'],
      prefix: 'AT',
      expected: ['Atlas'],
      should: 'match case-insensitively',
    },
    {
      given: 'a prefix matching mid-name but not at the start',
      items: ['Atlas', 'Acme'],
      prefix: 'tlas',
      expected: [],
      should: 'not match — it is a prefix filter, not a substring one',
    },
    {
      given: 'a prefix matching no item',
      items: ['Atlas', 'Acme'],
      prefix: 'z',
      expected: [],
      should: 'return nothing',
    },
    {
      given: 'a prefix longer than the item it resembles',
      items: ['Acme'],
      prefix: 'Acmeter',
      expected: [],
      should: 'return nothing',
    },
    {
      given: 'a prefix exactly as long as the item',
      items: ['Acme', 'Atlas'],
      prefix: 'Acme',
      expected: ['Acme'],
      should: 'include the exact match',
    },
    {
      given: 'a prefix containing a space',
      items: ['Jane Doe', 'Jane Roe', 'John Doe'],
      prefix: 'jane d',
      expected: ['Jane Doe'],
      should: 'match across the space',
    },
    {
      given: 'an empty item list',
      items: [],
      prefix: 'a',
      expected: [],
      should: 'return nothing',
    },
  ]

  for (const { given, items, prefix, expected, should } of fixtures) {
    assertEqual({
      given,
      should,
      actual: filterByPrefix(items, prefix),
      expected,
    })
  }
})
