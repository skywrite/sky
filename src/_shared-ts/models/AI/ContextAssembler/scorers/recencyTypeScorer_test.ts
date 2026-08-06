import { type CollectionEntityType, type CollectionItem, Document } from '#shared/models/Markdown/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { verdictScore } from '../mod.ts'
import { createRecencyTypeScorer } from './recencyTypeScorer.ts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDoc(body: string): Document {
  return Document.fromMarkdown(`---\n---\n${body}`)
}

function makeItem(
  overrides: Partial<CollectionItem<Document>> & { path: string; type: CollectionEntityType },
): CollectionItem<Document> {
  return { doc: makeDoc('content'), depth: 0, ...overrides }
}

/** Round to 2 decimal places for float comparison */
function round2(n: number): number {
  return Math.round(n * 100) / 100
}

const TODAY = new PlainDate(2026, 2, 23)

// ---------------------------------------------------------------------------
// Time-based recency scoring
// ---------------------------------------------------------------------------

// Recency decays linearly over 540 days: recency = 5 * (1 - daysSince / 540)
const recencyFixtures = [
  {
    path: '/Notebook/time/2026/02/23-01/02-23/day.md',
    type: 'day' as const,
    expected: 8, // recency 5.0 + type 3
    description: "today's day (recency 5.00 + type 3)",
  },
  {
    path: '/Notebook/time/2026/02/16-22/02-20/day.md',
    type: 'day' as const,
    expected: 7.97, // recency 5*(1-3/540)=4.972 + type 3 = 7.972 → round2 = 7.97
    description: '3-day-old day (recency 4.97 + type 3)',
  },
  {
    path: '/Notebook/time/2026/01/06-12/01-10/day.md',
    type: 'day' as const,
    expected: 7.59, // recency 5*(1-44/540)=4.593 + type 3 = 7.593 → round2 = 7.59
    description: '44-day-old day (recency 4.59 + type 3)',
  },
  {
    path: '/Notebook/time/2026/02/23-01/02-23/goals/q1-okr.md',
    type: 'goal' as const,
    expected: 10, // recency 5.0 + type 5
    description: "today's goal (recency 5.00 + type 5)",
  },
]

recencyFixtures.forEach((fixture) => {
  test(`recencyTypeScorer — ${fixture.description}`, () => {
    const scorer = createRecencyTypeScorer(TODAY)

    assert({
      given: fixture.description,
      should: `score ${fixture.expected}`,
      actual: round2(verdictScore(scorer(makeItem({ path: fixture.path, type: fixture.type })))),
      expected: fixture.expected,
    })
  })
})

// ---------------------------------------------------------------------------
// Entity docs (no date in path) — recency defaults to 3
// ---------------------------------------------------------------------------

const entityFixtures = [
  { type: 'person' as const, path: '/people/Alice.md', expected: 6, description: 'person (3 + 3)' },
  { type: 'org' as const, path: '/orgs/Acme.md', expected: 6, description: 'org (3 + 3)' },
  {
    type: 'project' as const,
    path: '/projects/open/Alpha/_project/overview.md',
    expected: 7,
    description: 'project (3 + 4)',
  },
  { type: 'goal' as const, path: '/goals/fitness.md', expected: 8, description: 'goal (3 + 5)' },
  { type: 'decision' as const, path: '/decisions/hire.md', expected: 8, description: 'decision (3 + 5)' },
  { type: 'idea' as const, path: '/ideas/thing.md', expected: 5, description: 'idea (3 + 2)' },
  { type: 'place' as const, path: '/places/cafe.md', expected: 4, description: 'place (3 + 1)' },
]

entityFixtures.forEach((fixture) => {
  test(`recencyTypeScorer — entity ${fixture.description}`, () => {
    const scorer = createRecencyTypeScorer(TODAY)

    assert({
      given: `${fixture.type} entity at depth 0`,
      should: `score ${fixture.expected}`,
      actual: verdictScore(scorer(makeItem({ path: fixture.path, type: fixture.type }))),
      expected: fixture.expected,
    })
  })
})

// ---------------------------------------------------------------------------
// Non-entity, non-time doc — recency defaults to 0
// ---------------------------------------------------------------------------

test('recencyTypeScorer — plain document gets recency 0', () => {
  const scorer = createRecencyTypeScorer(TODAY)

  assert({
    given: 'document type with no date in path',
    should: 'score 0 (recency 0 + type 0)',
    actual: verdictScore(scorer(makeItem({ path: '/docs/random.md', type: 'document' }))),
    expected: 0,
  })
})

// ---------------------------------------------------------------------------
// Depth penalty
// ---------------------------------------------------------------------------

const depthFixtures = [
  { depth: 0, expected: 6, description: 'depth 0 — no penalty' },
  { depth: 1, expected: 5, description: 'depth 1 — penalty 1' },
  { depth: 2, expected: 4, description: 'depth 2 — penalty 2' },
  { depth: 3, expected: 3, description: 'depth 3 — penalty 3 (max)' },
  { depth: 5, expected: 3, description: 'depth 5 — capped at penalty 3' },
]

depthFixtures.forEach((fixture) => {
  test(`recencyTypeScorer — ${fixture.description}`, () => {
    const scorer = createRecencyTypeScorer(TODAY)

    // person: recency 3 + type 3 = 6 base
    assert({
      given: `person at depth ${fixture.depth}`,
      should: `score ${fixture.expected}`,
      actual: verdictScore(scorer(makeItem({ path: '/people/X.md', type: 'person', depth: fixture.depth }))),
      expected: fixture.expected,
    })
  })
})

// ---------------------------------------------------------------------------
// Transitive org pruning — orgs at depth 2+ always get -Infinity
// ---------------------------------------------------------------------------

test('recencyTypeScorer — org at depth 0 scores normally', () => {
  const scorer = createRecencyTypeScorer(TODAY)

  assert({
    given: 'org at depth 0 (root document)',
    should: 'score 6 (recency 3 + type 3)',
    actual: verdictScore(scorer(makeItem({ path: '/orgs/Acme.md', type: 'org', depth: 0 }))),
    expected: 6,
  })
})

test('recencyTypeScorer — org at depth 1 scores normally', () => {
  const scorer = createRecencyTypeScorer(TODAY)

  assert({
    given: 'org at depth 1 (directly referenced)',
    should: 'score 5 (recency 3 + type 3 - depth 1)',
    actual: verdictScore(scorer(makeItem({ path: '/orgs/Acme.md', type: 'org', depth: 1 }))),
    expected: 5,
  })
})

test('recencyTypeScorer — org at depth 2 returns -Infinity', () => {
  const scorer = createRecencyTypeScorer(TODAY)

  assert({
    given: 'org at depth 2 (transitive, e.g. meeting → person → org)',
    should: 'return -Infinity to always prune',
    actual: verdictScore(scorer(makeItem({ path: '/orgs/Acme.md', type: 'org', depth: 2 }))),
    expected: -Infinity,
  })
})

test('recencyTypeScorer — org at depth 3 returns -Infinity', () => {
  const scorer = createRecencyTypeScorer(TODAY)

  assert({
    given: 'org at depth 3',
    should: 'return -Infinity to always prune',
    actual: verdictScore(scorer(makeItem({ path: '/orgs/Acme.md', type: 'org', depth: 3 }))),
    expected: -Infinity,
  })
})

// ---------------------------------------------------------------------------
// Project status penalty — open > completed > whiteboard > canceled > hold
// ---------------------------------------------------------------------------

const projectStatusFixtures = [
  {
    path: '/projects/open/Alpha/notes.md',
    type: 'document' as const,
    expected: 0,
    description: 'open folder file — no penalty',
  },
  {
    path: '/projects/completed/2022/Old-Thing/_project/overview.md',
    type: 'project' as const,
    expected: 6,
    description: 'completed overview (3 + 4 - 1)',
  },
  {
    path: '/projects/whiteboard/Moonshot/notes.md',
    type: 'document' as const,
    expected: -1.5,
    description: 'whiteboard folder file (0 + 0 - 1.5)',
  },
  {
    path: '/projects/canceled/Dead-End/notes.md',
    type: 'document' as const,
    expected: -2,
    description: 'canceled folder file (0 + 0 - 2)',
  },
  {
    path: '/projects/hold/Paused/notes.md',
    type: 'document' as const,
    expected: -3,
    description: 'hold folder file (0 + 0 - 3)',
  },
]

projectStatusFixtures.forEach((fixture) => {
  test(`recencyTypeScorer — ${fixture.description}`, () => {
    const scorer = createRecencyTypeScorer(TODAY)

    assert({
      given: fixture.description,
      should: `score ${fixture.expected}`,
      actual: verdictScore(scorer(makeItem({ path: fixture.path, type: fixture.type }))),
      expected: fixture.expected,
    })
  })
})
