import { assert, test } from '#test'
import PersonDocument from '#shared/models/Person/mod.ts'

// Test fixtures for current org getter
const orgCurrentFixtures = [
  {
    description: 'returns org from simple org field',
    yaml: { name: 'John', org: 'Acme Corp' },
    expected: 'Acme Corp',
  },
  {
    description: 'returns current from orgs.current field',
    yaml: { name: 'John', orgs: { current: 'Acme Corp' } },
    expected: 'Acme Corp',
  },
  {
    description: 'simple org takes precedence over orgs.current',
    yaml: { name: 'John', org: 'New Company', orgs: { current: 'Old Company' } },
    expected: 'New Company',
  },
  {
    description: 'returns undefined when no org',
    yaml: { name: 'John' },
    expected: undefined,
  },
  {
    description: 'returns undefined for empty string org',
    yaml: { name: 'John', org: '' },
    expected: undefined,
  },
  {
    description: 'returns undefined for whitespace-only org',
    yaml: { name: 'John', org: '   ' },
    expected: undefined,
  },
  {
    description: 'returns undefined for empty orgs.current',
    yaml: { name: 'John', orgs: { current: '' } },
    expected: undefined,
  },
  {
    description: 'falls back to orgs.current when org is empty',
    yaml: { name: 'John', org: '', orgs: { current: 'Fallback Corp' } },
    expected: 'Fallback Corp',
  },
]

orgCurrentFixtures.forEach((fixture) => {
  test(`Person.org - ${fixture.description}`, () => {
    const person = new PersonDocument(fixture.yaml)

    assert({
      given: fixture.description,
      should: fixture.expected ? `return "${fixture.expected}"` : 'return undefined',
      actual: person.org,
      expected: fixture.expected,
    })
  })
})

// Test fixtures for orgs.current array getter
const orgsCurrentFixtures = [
  {
    description: 'returns array from orgs.current array',
    yaml: { name: 'John', orgs: { current: ['Company A', 'Company B'] } },
    expected: ['Company A', 'Company B'],
  },
  {
    description: 'handles single string current org',
    yaml: { name: 'John', orgs: { current: 'Acme Corp' } },
    expected: ['Acme Corp'],
  },
  {
    description: 'returns empty array when no current orgs',
    yaml: { name: 'John', orgs: { past: ['Old Corp'] } },
    expected: [],
  },
  {
    description: 'filters out empty strings',
    yaml: { name: 'John', orgs: { current: ['Company A', '', 'Company B', '   '] } },
    expected: ['Company A', 'Company B'],
  },
  {
    description: 'returns empty array when orgs is not an object',
    yaml: { name: 'John', orgs: 'invalid' },
    expected: [],
  },
]

orgsCurrentFixtures.forEach((fixture) => {
  test(`Person.orgs.current - ${fixture.description}`, () => {
    const person = new PersonDocument(fixture.yaml)

    assert({
      given: fixture.description,
      should: `return ${JSON.stringify(fixture.expected)}`,
      actual: person.orgs.current,
      expected: fixture.expected,
    })
  })
})

// Test fixtures for past orgs getter
const orgsPastFixtures = [
  {
    description: 'returns array from orgs.past',
    yaml: { name: 'John', orgs: { past: ['Company A', 'Company B'] } },
    expected: ['Company A', 'Company B'],
  },
  {
    description: 'handles single string past org',
    yaml: { name: 'John', orgs: { past: 'Former Company' } },
    expected: ['Former Company'],
  },
  {
    description: 'returns empty array when no past orgs',
    yaml: { name: 'John', org: 'Current Corp' },
    expected: [],
  },
  {
    description: 'returns empty array when orgs has no past field',
    yaml: { name: 'John', orgs: { current: 'Current Corp' } },
    expected: [],
  },
  {
    description: 'filters out empty strings',
    yaml: { name: 'John', orgs: { past: ['Company A', '', 'Company B', '   '] } },
    expected: ['Company A', 'Company B'],
  },
  {
    description: 'returns empty array when orgs is not an object',
    yaml: { name: 'John', orgs: 'invalid' },
    expected: [],
  },
  {
    description: 'returns empty array when orgs is an array',
    yaml: { name: 'John', orgs: ['Company A', 'Company B'] },
    expected: [],
  },
  {
    description: 'returns empty array for empty past array',
    yaml: { name: 'John', orgs: { past: [] } },
    expected: [],
  },
  {
    description: 'returns empty array for empty string past',
    yaml: { name: 'John', orgs: { past: '' } },
    expected: [],
  },
  {
    description: 'filters non-string values from past array',
    yaml: { name: 'John', orgs: { past: ['Company A', 123, null, 'Company B'] } },
    expected: ['Company A', 'Company B'],
  },
]

orgsPastFixtures.forEach((fixture) => {
  test(`Person.orgs.past - ${fixture.description}`, () => {
    const person = new PersonDocument(fixture.yaml)

    assert({
      given: fixture.description,
      should: `return ${JSON.stringify(fixture.expected)}`,
      actual: person.orgs.past,
      expected: fixture.expected,
    })
  })
})

// Test fixtures for combined current + past scenarios
const combinedOrgFixtures = [
  {
    description: 'hybrid format with org and orgs.past',
    yaml: { name: 'John', org: 'Current Corp', orgs: { past: ['Old Corp', 'Ancient Inc'] } },
    expectedCurrent: 'Current Corp',
    expectedPast: ['Old Corp', 'Ancient Inc'],
  },
  {
    description: 'fully structured orgs format',
    yaml: { name: 'John', orgs: { current: 'Current Corp', past: ['Old Corp', 'Ancient Inc'] } },
    expectedCurrent: 'Current Corp',
    expectedPast: ['Old Corp', 'Ancient Inc'],
  },
  {
    description: 'only past orgs, no current',
    yaml: { name: 'John', orgs: { past: ['Old Corp'] } },
    expectedCurrent: undefined,
    expectedPast: ['Old Corp'],
  },
  {
    description: 'only current org via orgs.current',
    yaml: { name: 'John', orgs: { current: 'Current Corp' } },
    expectedCurrent: 'Current Corp',
    expectedPast: [],
  },
]

combinedOrgFixtures.forEach((fixture) => {
  test(`Person orgs combined - ${fixture.description}`, () => {
    const person = new PersonDocument(fixture.yaml)

    assert({
      given: `${fixture.description} (current)`,
      should: fixture.expectedCurrent ? `return "${fixture.expectedCurrent}"` : 'return undefined',
      actual: person.org,
      expected: fixture.expectedCurrent,
    })

    assert({
      given: `${fixture.description} (past)`,
      should: `return ${JSON.stringify(fixture.expectedPast)}`,
      actual: person.orgs.past,
      expected: fixture.expectedPast,
    })
  })
})
