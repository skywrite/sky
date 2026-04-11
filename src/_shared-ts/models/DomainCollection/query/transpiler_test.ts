/**
 * Selector → GraphQL transpiler tests.
 *
 * Rosetta stone: each fixture maps a selector string to expected GraphQL.
 */

import { assert, test } from '#test'
import { allFixtures } from './fixtures/mod.ts'
import { selectorToGraphQL } from './transpiler.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'

// Use a fixed date for deterministic tests
const TODAY = PlainDate.from('2025-01-30')
const YESTERDAY = TODAY.addDays(-1)

/**
 * Replace dynamic placeholders in expected output with actual values.
 */
function resolveDynamic(expected: string): string {
  return expected.replaceAll('$TODAY', TODAY.ymd).replaceAll('$YESTERDAY', YESTERDAY.ymd)
}

for (const { name, fixtures } of allFixtures) {
  for (const fixture of fixtures) {
    test(`selectorToGraphQL [${name}] - ${fixture.description}`, () => {
      const result = selectorToGraphQL(fixture.selector, { today: TODAY })
      const expected = fixture.dynamic ? resolveDynamic(fixture.expected) : fixture.expected

      assert({
        given: `selector "${fixture.selector}"`,
        should: 'transpile to expected GraphQL',
        actual: result.query,
        expected,
      })
    })
  }
}
