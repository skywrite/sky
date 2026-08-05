import { Document } from '#shared/models/Markdown/mod.ts'
import { assert, test } from '#test'
import { matchesDecided, matchesPending } from './decision.ts'

function md(yaml: string): Document {
  return Document.fromMarkdown(`---\n${yaml}\n---\n`)
}

// =============================================================================
// matchesPending
// =============================================================================

const pendingFixtures = [
  { yaml: 'name: Hire CTO\nidentified: 2025-01-01', expected: true, description: 'no resolved field' },
  { yaml: 'name: Hire CTO\nresolved: 2025-01-15', expected: false, description: 'has resolved field' },
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
  { yaml: 'name: Hire CTO\nresolved: 2025-01-15', expected: true, description: 'has resolved field' },
  { yaml: 'name: Hire CTO\nidentified: 2025-01-01', expected: false, description: 'no resolved field' },
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
