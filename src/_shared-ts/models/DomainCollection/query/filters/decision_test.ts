import { Document } from '#shared/models/Markdown/mod.ts'
import { assert, test } from '#test'
import { matchesDecided, matchesDecidedGte, matchesPending } from './decision.ts'

function md(yaml: string): Document {
  return Document.fromMarkdown(`---\n${yaml}\n---\n`)
}

// =============================================================================
// matchesPending
// =============================================================================

const pendingFixtures = [
  { yaml: 'name: Hire CTO\nidentified: 2025-01-01', expected: true, description: 'no decided field' },
  { yaml: 'name: Hire CTO\ndecided: 2025-01-15', expected: false, description: 'has decided field' },
]

for (const { yaml, expected, description } of pendingFixtures) {
  test(`matchesPending - ${description}`, () => {
    const doc = md(yaml)
    assert({
      given: description,
      should: expected ? 'be pending' : 'not be pending',
      actual: matchesPending(doc),
      expected,
    })
  })
}

// =============================================================================
// matchesDecided
// =============================================================================

const decidedFixtures = [
  { yaml: 'name: Hire CTO\ndecided: 2025-01-15', expected: true, description: 'has decided field' },
  { yaml: 'name: Hire CTO\nidentified: 2025-01-01', expected: false, description: 'no decided field' },
]

for (const { yaml, expected, description } of decidedFixtures) {
  test(`matchesDecided - ${description}`, () => {
    const doc = md(yaml)
    assert({
      given: description,
      should: expected ? 'be decided' : 'not be decided',
      actual: matchesDecided(doc),
      expected,
    })
  })
}

// =============================================================================
// matchesDecidedGte
// =============================================================================

const decidedSinceFixtures = [
  {
    yaml: 'name: Ship Widget\ndecided: 2026-01-20T09:00:00-06:00[America/Chicago]',
    since: '2026-01-01',
    expected: true,
    description: 'made after the day',
  },
  {
    yaml: 'name: Ship Widget\ndecided: "2026-01-05 09:15"',
    since: '2026-01-05',
    expected: true,
    description: 'made on the day',
  },
  {
    yaml: 'name: Ship Widget\ndecided: 2025-12-01T09:00:00-06:00[America/Chicago]',
    since: '2026-01-01',
    expected: false,
    description: 'made before the day',
  },
  {
    yaml: 'name: Hire CTO\nidentified: 2026-01-10\ndecided:',
    since: '2026-01-01',
    expected: false,
    description: 'not made yet',
  },
]

for (const { yaml, since, expected, description } of decidedSinceFixtures) {
  test(`matchesDecidedGte - ${description}`, () => {
    assert({
      given: `a decision ${description}`,
      should: expected ? 'match' : 'not match',
      actual: matchesDecidedGte(md(yaml), since),
      expected,
    })
  })
}
