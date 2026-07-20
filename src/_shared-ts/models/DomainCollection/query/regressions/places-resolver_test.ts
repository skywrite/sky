/**
 * Regression: places resolver was missing from createDomainResolvers, causing
 * "Cannot return null for non-nullable field Query.places" when AI-generated
 * queries included places (e.g., `sky ai:context:files "Argentina"`).
 *
 * The schema defined `places(where: PlaceFilter, limit: Int): [Place!]!` but
 * the resolver factory returned no `places` function.
 */

import { assert, test } from '#test'
import { Document } from '#shared/models/Markdown/mod.ts'
import type MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import { createDomainResolvers } from '../resolvers.ts'
import { executeQuery } from '../execute.ts'

// =============================================================================
// Fixtures
// =============================================================================

function createMockCollection(items: Array<{ doc: Document; path: string }>) {
  return {
    getAll: () => ({
      toArray: () => items,
    }),
  }
}

function createMockStore(): MarkdownStore {
  const placesData = [
    {
      doc: Document.fromMarkdown(`---
name: Don Julio
type: eat
address: Guatemala 4699, Buenos Aires
location:
  country: AR
  city: Buenos Aires
tags: [Restaurant, Steak]
---
Famous steakhouse in Palermo.`),
      path: '/test/places/AR/Buenos-Aires/eat/Don-Julio.md',
    },
    {
      doc: Document.fromMarkdown(`---
name: Café Tortoni
type: drink
address: Av. de Mayo 825, Buenos Aires
location:
  country: AR
  city: Buenos Aires
tags: [Cafe, Historic]
---
Historic café since 1858.`),
      path: '/test/places/AR/Buenos-Aires/drink/Cafe-Tortoni.md',
    },
    {
      doc: Document.fromMarkdown(`---
name: Ty Bar
type: drink
location:
  country: US
  region: NY
  city: New York
tags: [Bar]
---
Cocktail bar.`),
      path: '/test/places/US/NY/New-York/drink/Ty-Bar.md',
    },
  ]

  return {
    people: createMockCollection([]),
    orgs: createMockCollection([]),
    projects: { ...createMockCollection([]), getDocuments: () => ({ toArray: () => [] }) },
    decisions: createMockCollection([]),
    goals: createMockCollection([]),
    ideas: createMockCollection([]),
    places: createMockCollection(placesData),
    time: createMockCollection([]),
  } as unknown as MarkdownStore
}

// =============================================================================
// Tests
// =============================================================================

test('regression: places resolver exists and returns results', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  assert({
    given: 'createDomainResolvers',
    should: 'include a places resolver function',
    actual: typeof resolvers.places,
    expected: 'function',
  })

  const result = resolvers.places({})

  assert({
    given: 'no filter on 3 places',
    should: 'return all 3',
    actual: result.length,
    expected: 3,
  })
})

test('regression: places query with country filter via GraphQL execution', async () => {
  const store = createMockStore()

  // This is the exact pattern that failed before the fix:
  // AI generated `places(where: { country: "AR" })` which caused
  // "Cannot return null for non-nullable field Query.places"
  const query = '{ places(where: { country: "AR" }) { name type country city path } }'

  const result = await executeQuery<{
    places: Array<{ name: string; type: string; country: string; city: string; path: string }>
  }>(query, store)

  assert({
    given: 'a GraphQL places query with country: AR',
    should: 'not return errors',
    actual: result.errors,
    expected: undefined,
  })

  assert({
    given: 'country filter AR with 2 AR places and 1 US place',
    should: 'return 2 places',
    actual: result.data?.places.length,
    expected: 2,
  })

  const names = result.data?.places.map((p) => p.name).sort()

  assert({
    given: 'country filter AR',
    should: 'return the AR places',
    actual: names,
    expected: ['Café Tortoni', 'Don Julio'],
  })
})

test('regression: places query returns all schema fields', async () => {
  const store = createMockStore()
  const query = '{ places { name type address site googleMapsUrl country city tags markdown path } }'

  const result = await executeQuery<{
    places: Array<{
      name: string
      type: string
      address: string | null
      site: string | null
      googleMapsUrl: string | null
      country: string | null
      city: string | null
      tags: string[]
      markdown: string
      path: string
    }>
  }>(query, store)

  assert({
    given: 'a query requesting all Place fields',
    should: 'not return errors',
    actual: result.errors,
    expected: undefined,
  })

  const donJulio = result.data?.places.find((p) => p.name === 'Don Julio')

  assert({
    given: 'Don Julio place',
    should: 'have address',
    actual: donJulio?.address,
    expected: 'Guatemala 4699, Buenos Aires',
  })

  assert({
    given: 'Don Julio place',
    should: 'have country from nested location',
    actual: donJulio?.country,
    expected: 'AR',
  })

  assert({
    given: 'Don Julio place',
    should: 'have city from nested location',
    actual: donJulio?.city,
    expected: 'Buenos Aires',
  })

  assert({
    given: 'Don Julio place',
    should: 'have tags',
    actual: donJulio?.tags,
    expected: ['Restaurant', 'Steak'],
  })
})
