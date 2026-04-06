/**
 * Tests for GraphQL query execution against DomainCollection.
 */

import { assert, test } from '#test'
import { Document } from '#shared/models/Markdown/mod.ts'
import MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import { executeQuery, isGraphQL } from './execute.ts'

// =============================================================================
// Test Fixtures
// =============================================================================

function createMockCollection(items: Array<{ doc: Document; path: string }>) {
  return {
    getAll: () => ({
      toArray: () => items,
    }),
  }
}

function createMockStore(): MarkdownStore {
  // Create a minimal mock store with test data
  const peopleData = [
    {
      doc: Document.fromMarkdown(`---
name: Alice Smith
org: Acme Corp
title: Engineer
tags: [Engineering]
---
Alice is an engineer.`),
      path: '/test/people/alice.md',
    },
    {
      doc: Document.fromMarkdown(`---
name: Bob Jones
org: MoonPay
title: Designer
tags: [Design]
---
Bob is a designer.`),
      path: '/test/people/bob.md',
    },
  ]

  const orgsData = [
    {
      doc: Document.fromMarkdown(`---
name: Acme Corp
sector: Technology
tags: [Organization/Company]
---
A tech company.`),
      path: '/test/orgs/acme.md',
    },
  ]

  const store = {
    people: createMockCollection(peopleData),
    orgs: createMockCollection(orgsData),
    projects: createMockCollection([]),
    decisions: createMockCollection([]),
    goals: createMockCollection([]),
    ideas: createMockCollection([]),
    places: createMockCollection([]),
    time: createMockCollection([]),
  } as unknown as MarkdownStore

  return store
}

// =============================================================================
// isGraphQL Tests
// =============================================================================

const isGraphQLFixtures = [
  { input: '{ people { name } }', expected: true, desc: 'simple query' },
  { input: 'query { people { name } }', expected: true, desc: 'explicit query keyword' },
  { input: 'query{people{name}}', expected: true, desc: 'no spaces' },
  { input: '  { people { name } }', expected: true, desc: 'leading whitespace' },
  { input: 'meeting:recent(7d)', expected: false, desc: 'CSS selector' },
  { input: 'person[org=MoonPay]', expected: false, desc: 'CSS selector with attribute' },
  { input: '*[tags~=Work]', expected: false, desc: 'CSS selector with wildcard' },
]

for (const { input, expected, desc } of isGraphQLFixtures) {
  test(`isGraphQL - ${desc}`, () => {
    assert({
      given: `input "${input}"`,
      should: `return ${expected}`,
      actual: isGraphQL(input),
      expected,
    })
  })
}

// =============================================================================
// executeQuery Tests
// =============================================================================

test('executeQuery - returns people with requested fields', async () => {
  const store = createMockStore()
  const query = '{ people { name org path } }'

  const result = await executeQuery<{ people: Array<{ name: string; org: string; path: string }> }>(query, store)

  assert({
    given: 'a query for people with name, org, path',
    should: 'return people array with those fields',
    actual: result.errors,
    expected: undefined,
  })

  assert({
    given: 'a query for people',
    should: 'return 2 people',
    actual: result.data?.people.length,
    expected: 2,
  })

  assert({
    given: 'a query for people',
    should: 'include Alice',
    actual: result.data?.people.some((p) => p.name === 'Alice Smith'),
    expected: true,
  })
})

test('executeQuery - filters people by org', async () => {
  const store = createMockStore()
  const query = '{ people(where: { org: "MoonPay" }) { name org } }'

  const result = await executeQuery<{ people: Array<{ name: string; org: string }> }>(query, store)

  assert({
    given: 'a query for people at MoonPay',
    should: 'return only Bob',
    actual: result.data?.people.length,
    expected: 1,
  })

  assert({
    given: 'a query for people at MoonPay',
    should: 'return Bob Jones',
    actual: result.data?.people[0]?.name,
    expected: 'Bob Jones',
  })
})

test('executeQuery - respects limit', async () => {
  const store = createMockStore()
  const query = '{ people(limit: 1) { name } }'

  const result = await executeQuery<{ people: Array<{ name: string }> }>(query, store)

  assert({
    given: 'a query with limit 1',
    should: 'return only 1 person',
    actual: result.data?.people.length,
    expected: 1,
  })
})

test('executeQuery - returns orgs with derived kind', async () => {
  const store = createMockStore()
  const query = '{ orgs { name kind } }'

  const result = await executeQuery<{ orgs: Array<{ name: string; kind: string }> }>(query, store)

  assert({
    given: 'a query for orgs',
    should: 'return Acme Corp',
    actual: result.data?.orgs[0]?.name,
    expected: 'Acme Corp',
  })

  assert({
    given: 'an org with Organization/Company tag',
    should: 'derive kind as company',
    actual: result.data?.orgs[0]?.kind,
    expected: 'company',
  })
})

test('executeQuery - returns errors for invalid query', async () => {
  const store = createMockStore()
  const query = '{ invalidField }'

  const result = await executeQuery(query, store)

  assert({
    given: 'an invalid query',
    should: 'return errors',
    actual: result.errors !== undefined && result.errors.length > 0,
    expected: true,
  })
})

test('executeQuery - empty result for non-matching filter', async () => {
  const store = createMockStore()
  const query = '{ people(where: { org: "NonExistent" }) { name } }'

  const result = await executeQuery<{ people: Array<{ name: string }> }>(query, store)

  assert({
    given: 'a query with non-matching filter',
    should: 'return empty array',
    actual: result.data?.people.length,
    expected: 0,
  })
})
