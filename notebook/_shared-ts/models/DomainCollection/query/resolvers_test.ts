/**
 * Tests for DomainCollection GraphQL resolvers.
 */

import { assert, test } from '#test'
import { Document } from '#shared/models/Markdown/mod.ts'
import type MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import { createDomainResolvers } from './resolvers.ts'

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
  const meetingsData = [
    {
      doc: Document.fromMarkdown(`---
who: Alice, Bob
when: "14:00"
medium: Zoom
date: "2026-02-01"
summary: Project kickoff
tags: [Work]
---
Meeting notes here.`),
      path: '/test/time/2026/01/26-01/01/actions/meetings/meeting1.md',
    },
    {
      doc: Document.fromMarkdown(`---
who: Charlie
when: "10:00"
medium: Phone
date: "2026-01-28"
summary: Quick sync
tags: [Personal]
---
Phone call notes.`),
      path: '/test/time/2026/01/26-01/28/actions/meetings/meeting2.md',
    },
  ]

  // Message with created date (2026-02-18) different from path date (2026-02-05)
  const messagesData = [
    {
      doc: Document.fromMarkdown(`---
from: Tanisha
to: JP
when: "18:18"
medium: Slack
summary: M&A candidate
created: 2026-02-18
---
Old message saved later.`),
      path: '/test/time/2026/02/02-08/05/actions/messages/old-message.md',
    },
    {
      doc: Document.fromMarkdown(`---
from: Kevin
to: JP
when: "09:00"
medium: Slack
summary: Status update
created: 2026-02-17
---
Recent message.`),
      path: '/test/time/2026/02/16-22/17/actions/messages/recent-message.md',
    },
  ]

  const peopleData = [
    {
      doc: Document.fromMarkdown(`---
name: Alice Smith
org: Acme Corp
title: Engineer
tags: [Engineering]
rel: [Bob Jones]
---
Alice is an engineer.`),
      path: '/test/people/alice.md',
    },
  ]

  const decisionsData = [
    {
      doc: Document.fromMarkdown(`---
name: hire-designer
summary: Hire a new designer
identified: "2026-01-15"
target: "2026-02-01"
tags: [Hiring]
---
Decision details.`),
      path: '/test/decisions/hire-designer.md',
    },
    {
      doc: Document.fromMarkdown(`---
name: new-office
summary: Move to new office
identified: "2026-01-10"
resolved: "2026-01-25"
decided: "2026-01-25"
tags: [Operations]
---
Decided to move.`),
      path: '/test/decisions/new-office.md',
    },
  ]

  const placesData = [
    {
      doc: Document.fromMarkdown(`---
name: Don Julio
type: eat
address: Guatemala 4699, Buenos Aires
site: https://donjulio.com
googleMapsUrl: https://maps.google.com/?q=Don+Julio
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
name: Ty Bar
type: drink
address: 2 E 55th St, New York
location:
  country: US
  region: NY
  city: New York
  subcity: Manhattan
tags: [Bar, Cocktails]
---
Classic cocktail bar.`),
      path: '/test/places/US/NY/New-York/Manhattan/drink/Ty-Bar.md',
    },
  ]

  return {
    people: createMockCollection(peopleData),
    orgs: createMockCollection([]),
    projects: createMockCollection([]),
    decisions: createMockCollection(decisionsData),
    goals: createMockCollection([]),
    ideas: createMockCollection([]),
    places: createMockCollection(placesData),
    time: createMockCollection([...meetingsData, ...messagesData]),
  } as unknown as MarkdownStore
}

// =============================================================================
// Resolver Tests
// =============================================================================

test('resolvers - meetings returns all meetings', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  const result = resolvers.meetings({})

  assert({
    given: 'no filter',
    should: 'return all meetings',
    actual: result.length,
    expected: 2,
  })
})

test('resolvers - meetings filters by who_contains', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  const result = resolvers.meetings({ where: { who_contains: 'Alice' } })

  assert({
    given: 'who_contains filter for Alice',
    should: 'return 1 meeting',
    actual: result.length,
    expected: 1,
  })

  assert({
    given: 'who_contains filter for Alice',
    should: 'return meeting with Alice',
    actual: result[0]?.who.includes('Alice'),
    expected: true,
  })
})

test('resolvers - meetings respects limit', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  const result = resolvers.meetings({ limit: 1 })

  assert({
    given: 'limit of 1',
    should: 'return 1 meeting',
    actual: result.length,
    expected: 1,
  })
})

test('resolvers - people includes rel as array', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  const result = resolvers.people({})

  assert({
    given: 'a person with rel field',
    should: 'include rel as array',
    actual: Array.isArray(result[0]?.rel),
    expected: true,
  })

  assert({
    given: 'a person with rel field',
    should: 'contain related person',
    actual: result[0]?.rel.includes('Bob Jones'),
    expected: true,
  })
})

test('resolvers - decisions pending filter', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  const pending = resolvers.decisions({ where: { pending: true } })
  const decided = resolvers.decisions({ where: { decided: true } })

  assert({
    given: 'pending filter',
    should: 'return 1 pending decision',
    actual: pending.length,
    expected: 1,
  })

  assert({
    given: 'pending filter',
    should: 'return hire-designer',
    actual: pending[0]?.name,
    expected: 'hire-designer',
  })

  assert({
    given: 'decided filter',
    should: 'return 1 decided decision',
    actual: decided.length,
    expected: 1,
  })

  assert({
    given: 'decided filter',
    should: 'return new-office',
    actual: decided[0]?.name,
    expected: 'new-office',
  })
})

test('resolvers - decisions isPending computed correctly', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  const all = resolvers.decisions({})
  const pendingDecision = all.find((d) => d.name === 'hire-designer')
  const decidedDecision = all.find((d) => d.name === 'new-office')

  assert({
    given: 'a pending decision',
    should: 'have isPending true',
    actual: pendingDecision?.isPending,
    expected: true,
  })

  assert({
    given: 'a decided decision',
    should: 'have isPending false',
    actual: decidedDecision?.isPending,
    expected: false,
  })
})

test('resolvers - meetings includes path', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  const result = resolvers.meetings({})

  assert({
    given: 'a meeting',
    should: 'include path',
    actual: result[0]?.path.endsWith('.md'),
    expected: true,
  })
})

test('resolvers - meetings includes markdown', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  const result = resolvers.meetings({})

  assert({
    given: 'a meeting',
    should: 'include markdown content',
    actual: result[0]?.markdown.includes('Meeting notes'),
    expected: true,
  })
})

// =============================================================================
// Places Resolver Tests
// =============================================================================

test('resolvers - places returns all places', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  const result = resolvers.places({})

  assert({
    given: 'no filter',
    should: 'return all places',
    actual: result.length,
    expected: 2,
  })
})

test('resolvers - places maps fields correctly', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  const result = resolvers.places({})
  const donJulio = result.find((p) => p.name === 'Don Julio')

  assert({
    given: 'a place with all fields',
    should: 'map name',
    actual: donJulio?.name,
    expected: 'Don Julio',
  })

  assert({
    given: 'a place with all fields',
    should: 'map type',
    actual: donJulio?.type,
    expected: 'eat',
  })

  assert({
    given: 'a place with all fields',
    should: 'map address',
    actual: donJulio?.address,
    expected: 'Guatemala 4699, Buenos Aires',
  })

  assert({
    given: 'a place with location.country',
    should: 'extract country from nested location',
    actual: donJulio?.country,
    expected: 'AR',
  })

  assert({
    given: 'a place with location.city',
    should: 'extract city from nested location',
    actual: donJulio?.city,
    expected: 'Buenos Aires',
  })
})

test('resolvers - places filters by country', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  const result = resolvers.places({ where: { country: 'AR' } })

  assert({
    given: 'country filter for AR',
    should: 'return 1 place',
    actual: result.length,
    expected: 1,
  })

  assert({
    given: 'country filter for AR',
    should: 'return Don Julio',
    actual: result[0]?.name,
    expected: 'Don Julio',
  })
})

test('resolvers - places filters by type', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  const result = resolvers.places({ where: { type: 'drink' } })

  assert({
    given: 'type filter for drink',
    should: 'return 1 place',
    actual: result.length,
    expected: 1,
  })

  assert({
    given: 'type filter for drink',
    should: 'return Ty Bar',
    actual: result[0]?.name,
    expected: 'Ty Bar',
  })
})

test('resolvers - places filters by city_contains', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  const result = resolvers.places({ where: { city_contains: 'Buenos' } })

  assert({
    given: 'city_contains filter for Buenos',
    should: 'return 1 place',
    actual: result.length,
    expected: 1,
  })
})

test('resolvers - places filters by name_contains', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  const result = resolvers.places({ where: { name_contains: 'Ty' } })

  assert({
    given: 'name_contains filter for Ty',
    should: 'return 1 place',
    actual: result.length,
    expected: 1,
  })

  assert({
    given: 'name_contains filter for Ty',
    should: 'return Ty Bar',
    actual: result[0]?.name,
    expected: 'Ty Bar',
  })
})

test('resolvers - places respects limit', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  const result = resolvers.places({ limit: 1 })

  assert({
    given: 'limit of 1',
    should: 'return 1 place',
    actual: result.length,
    expected: 1,
  })
})

// =============================================================================
// Date filtering uses path date, not created date
// =============================================================================

test('resolvers - messages date filter uses path date, not created', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  // Filter for Feb 16-18 range — old message has created: 2026-02-18 but path date is Feb 5
  const result = resolvers.messages({ where: { date_gte: '2026-02-16', date_lte: '2026-02-18' } })

  assert({
    given: 'date range 2026-02-16 to 2026-02-18',
    should: 'return only the message whose path date is in range',
    actual: result.length,
    expected: 1,
  })

  assert({
    given: 'date range 2026-02-16 to 2026-02-18',
    should: 'return the Feb 17 message, not the Feb 5 message with created: Feb 18',
    actual: result[0]?.from,
    expected: 'Kevin',
  })
})

test('resolvers - messages date filter excludes old path despite recent created', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  // Filter for Feb 5 — should find the old message by its path date
  const result = resolvers.messages({ where: { date_gte: '2026-02-05', date_lte: '2026-02-05' } })

  assert({
    given: 'date range for Feb 5 only',
    should: 'find message by path date even though created is Feb 18',
    actual: result.length,
    expected: 1,
  })

  assert({
    given: 'date range for Feb 5 only',
    should: 'return the Tanisha message',
    actual: result[0]?.from,
    expected: 'Tanisha',
  })
})

test('resolvers - documents date filter uses path date, not created', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  // The documents resolver returns all types — filter to Feb 16-18
  const result = resolvers.documents({ where: { date_gte: '2026-02-16', date_lte: '2026-02-18' } })
  const messagePaths = result.map((d) => d.path).filter((p) => p.includes('/messages/'))

  assert({
    given: 'documents query for Feb 16-18',
    should: 'not include the Feb 5 message (even though created is Feb 18)',
    actual: messagePaths.some((p) => p.includes('old-message')),
    expected: false,
  })

  assert({
    given: 'documents query for Feb 16-18',
    should: 'include the Feb 17 message',
    actual: messagePaths.some((p) => p.includes('recent-message')),
    expected: true,
  })
})

test('resolvers - meetings date filter uses path date over created', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  // Meeting1 has date: 2026-02-01 (YAML), path is Jan 26-01/01
  // Meeting2 has date: 2026-01-28 (YAML), path is Jan 26-01/28
  // YAML date field still takes priority over path
  const result = resolvers.meetings({ where: { date_gte: '2026-02-01', date_lte: '2026-02-01' } })

  assert({
    given: 'date filter for Feb 1 — meeting has YAML date: 2026-02-01',
    should: 'use YAML date field (highest priority)',
    actual: result.length,
    expected: 1,
  })
})
