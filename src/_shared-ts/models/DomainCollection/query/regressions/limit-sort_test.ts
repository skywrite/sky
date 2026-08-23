/**
 * Regression: limit used to slice without sorting, so oldest-first filesystem
 * walk order meant limit:N returned the N oldest items instead of N newest.
 */

import { Document } from '#shared/models/Markdown/mod.ts'
import type MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import { assert, test } from '#test'
import { createDomainResolvers } from '../resolvers/mod.ts'

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

/** Store with items in oldest-first order (simulating filesystem walk order). */
function createMockStore(): MarkdownStore {
  const meetingsData = [
    {
      doc: Document.fromMarkdown(`---\nwho: Alice\nmedium: Zoom\ndate: "2025-03-10"\nsummary: Old meeting\n---\nOld.`),
      path: '/test/time/2025/03/10-16/03-10/actions/meetings/old1.md',
    },
    {
      doc: Document.fromMarkdown(`---\nwho: Bob\nmedium: Phone\ndate: "2025-06-15"\nsummary: Mid meeting\n---\nMid.`),
      path: '/test/time/2025/06/09-15/06-15/actions/meetings/mid1.md',
    },
    {
      doc: Document.fromMarkdown(
        `---\nwho: Charlie\nmedium: Zoom\ndate: "2026-01-20"\nsummary: Recent meeting\n---\nRecent.`,
      ),
      path: '/test/time/2026/01/19-25/01-20/actions/meetings/recent1.md',
    },
    {
      doc: Document.fromMarkdown(
        `---\nwho: Dana\nmedium: Zoom\ndate: "2026-02-06"\nsummary: Latest meeting\n---\nLatest.`,
      ),
      path: '/test/time/2026/02/02-08/02-06/actions/meetings/latest1.md',
    },
  ]

  const daysData = [
    {
      doc: Document.fromMarkdown(`---\ndate: "2025-03-10"\nstarted: "08:00"\n---\nOld day.`),
      path: '/test/time/2025/03/10-16/03-10/day.md',
    },
    {
      doc: Document.fromMarkdown(`---\ndate: "2025-06-15"\nstarted: "09:00"\n---\nMid day.`),
      path: '/test/time/2025/06/09-15/06-15/day.md',
    },
    {
      doc: Document.fromMarkdown(`---\ndate: "2026-01-20"\nstarted: "07:30"\n---\nRecent day.`),
      path: '/test/time/2026/01/19-25/01-20/day.md',
    },
    {
      doc: Document.fromMarkdown(`---\ndate: "2026-02-06"\nstarted: "08:15"\n---\nLatest day.`),
      path: '/test/time/2026/02/02-08/02-06/day.md',
    },
  ]

  const journalsData = [
    {
      doc: Document.fromMarkdown(`---\ndate: "2025-03-10"\ntime: "21:00"\ntags: Journal\n---\nOld journal.`),
      path: '/test/time/2025/03/10-16/03-10/actions/journal/reflection.md',
    },
    {
      doc: Document.fromMarkdown(`---\ndate: "2026-02-06"\ntime: "22:00"\ntags: Journal\n---\nLatest journal.`),
      path: '/test/time/2026/02/02-08/02-06/actions/journal/reflection.md',
    },
  ]

  return {
    people: createMockCollection([]),
    orgs: createMockCollection([]),
    projects: { ...createMockCollection([]), getDocuments: () => ({ toArray: () => [] }) },
    decisions: createMockCollection([]),
    goals: createMockCollection([]),
    streaks: createMockCollection([]),
    tracking: createMockCollection([]),
    ideas: createMockCollection([]),
    places: createMockCollection([]),
    time: createMockCollection([...meetingsData, ...daysData, ...journalsData]),
    library: createMockCollection([]),
  } as unknown as MarkdownStore
}

// =============================================================================
// Tests
// =============================================================================

test('resolvers - meetings with limit returns most recent, not oldest', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  const result = resolvers.meetings({ limit: 2 })

  assert({
    given: 'limit: 2 with 4 meetings in oldest-first order',
    should: 'return 2 results',
    actual: result.length,
    expected: 2,
  })

  assert({
    given: 'limit: 2',
    should: 'return the most recent meeting first',
    actual: result[0]?.date,
    expected: '2026-02-06',
  })

  assert({
    given: 'limit: 2',
    should: 'return the second most recent meeting second',
    actual: result[1]?.date,
    expected: '2026-01-20',
  })
})

test('resolvers - meetings without limit are sorted by date desc', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  const result = resolvers.meetings({})
  const dates = result.map((m) => m.date)

  assert({
    given: 'no limit, 4 meetings in oldest-first store order',
    should: 'return meetings sorted newest first',
    actual: dates,
    expected: ['2026-02-06', '2026-01-20', '2025-06-15', '2025-03-10'],
  })
})

test('resolvers - days with limit returns most recent, not oldest', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  const result = resolvers.days({ limit: 2 })

  assert({
    given: 'limit: 2 with 4 days in oldest-first order',
    should: 'return 2 results',
    actual: result.length,
    expected: 2,
  })

  assert({
    given: 'limit: 2',
    should: 'return the most recent day first',
    actual: result[0]?.date,
    expected: '2026-02-06',
  })

  assert({
    given: 'limit: 2',
    should: 'return the second most recent day second',
    actual: result[1]?.date,
    expected: '2026-01-20',
  })
})

test('resolvers - journals with limit returns most recent, not oldest', () => {
  const store = createMockStore()
  const resolvers = createDomainResolvers(store)

  const result = resolvers.journals({ limit: 1 })

  assert({
    given: 'limit: 1 with 2 journals in oldest-first order',
    should: 'return 1 result',
    actual: result.length,
    expected: 1,
  })

  assert({
    given: 'limit: 1',
    should: 'return the most recent journal',
    actual: result[0]?.date,
    expected: '2026-02-06',
  })
})
