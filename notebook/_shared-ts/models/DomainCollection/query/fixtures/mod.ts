/**
 * Selector → GraphQL transpiler fixtures.
 *
 * Each fixture maps a selector string to expected GraphQL output.
 */

import typeSelectors from './type-selectors.ts'
import attributeExact from './attribute-exact.ts'
import attributeContains from './attribute-contains.ts'
import attributePrefix from './attribute-prefix.ts'
import attributeSuffix from './attribute-suffix.ts'
import attributeSubstring from './attribute-substring.ts'
import pseudoTime from './pseudo-time.ts'
import pseudoStatus from './pseudo-status.ts'
import pseudoHas from './pseudo-has.ts'
import pseudoInvolves from './pseudo-involves.ts'
import pseudoContains from './pseudo-contains.ts'
import pseudoNot from './pseudo-not.ts'
import combinedAnd from './combined-and.ts'
import combinedOr from './combined-or.ts'
import complex from './complex.ts'

export interface TranspilerFixture {
  selector: string
  expected: string
  description: string
  dynamic?: boolean // Has runtime values like $TODAY
}

export interface FixtureGroup {
  name: string
  fixtures: TranspilerFixture[]
}

export const allFixtures: FixtureGroup[] = [
  { name: 'Type Selectors', fixtures: typeSelectors },
  { name: 'Attribute - Exact Match', fixtures: attributeExact },
  { name: 'Attribute - Contains', fixtures: attributeContains },
  { name: 'Attribute - Starts With', fixtures: attributePrefix },
  { name: 'Attribute - Ends With', fixtures: attributeSuffix },
  { name: 'Attribute - Substring', fixtures: attributeSubstring },
  { name: 'Pseudo - Time', fixtures: pseudoTime },
  { name: 'Pseudo - Status', fixtures: pseudoStatus },
  { name: 'Pseudo - :has()', fixtures: pseudoHas },
  { name: 'Pseudo - :involves()', fixtures: pseudoInvolves },
  { name: 'Pseudo - :contains()', fixtures: pseudoContains },
  { name: 'Pseudo - :not()', fixtures: pseudoNot },
  { name: 'Combined - AND', fixtures: combinedAnd },
  { name: 'Combined - OR', fixtures: combinedOr },
  { name: 'Complex Queries', fixtures: complex },
]

export {
  attributeContains,
  attributeExact,
  attributePrefix,
  attributeSubstring,
  attributeSuffix,
  combinedAnd,
  combinedOr,
  complex,
  pseudoContains,
  pseudoHas,
  pseudoInvolves,
  pseudoNot,
  pseudoStatus,
  pseudoTime,
  typeSelectors,
}
