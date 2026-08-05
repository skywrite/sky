import { Document } from '#shared/models/Markdown/mod.ts'
import { assert, test } from '#test'
import { matchesInvolves } from './involves.ts'
import type { NameResolver } from './involves.ts'

function md(yaml: string): Document {
  return Document.fromMarkdown(`---\n${yaml}\n---\n`)
}

// =============================================================================
// matchesInvolves
// =============================================================================

const fixtures = [
  { yaml: 'who: Alice Smith', name: 'Alice', expected: true, description: 'who field contains name' },
  { yaml: 'who:\n  - Alice Smith\n  - Bob Jones', name: 'Bob', expected: true, description: 'who array contains name' },
  { yaml: 'from: Alice Smith', name: 'Alice', expected: true, description: 'from field' },
  { yaml: 'to: Bob Jones', name: 'Bob', expected: true, description: 'to field' },
  { yaml: 'to:\n  - Alice\n  - Bob', name: 'Alice', expected: true, description: 'to array' },
  { yaml: 'name: Alice Smith', name: 'Alice', expected: true, description: 'name field (person doc)' },
  { yaml: 'rel:\n  - Alice Smith', name: 'Alice', expected: true, description: 'rel field' },
  { yaml: 'who: Bob Jones', name: 'Alice', expected: false, description: 'name not in doc' },
  { yaml: 'who: Alice, Bob, Carol', name: 'Bob', expected: true, description: 'comma-separated who' },
]

for (const { yaml, name, expected, description } of fixtures) {
  test(`matchesInvolves - ${description}`, () => {
    const doc = md(yaml)
    assert({
      given: description,
      should: expected ? 'match' : 'not match',
      actual: matchesInvolves(doc, name),
      expected,
    })
  })
}

// =============================================================================
// Null Safety
// =============================================================================

test('matchesInvolves - handles null name parameter', () => {
  const doc = md('who: Alice Smith')
  assert({
    given: 'null name parameter',
    should: 'return false without throwing',
    actual: matchesInvolves(doc, null as unknown as string),
    expected: false,
  })
})

test('matchesInvolves - handles undefined name parameter', () => {
  const doc = md('who: Alice Smith')
  assert({
    given: 'undefined name parameter',
    should: 'return false without throwing',
    actual: matchesInvolves(doc, undefined as unknown as string),
    expected: false,
  })
})

test('matchesInvolves - handles doc with empty rel', () => {
  const doc = Document.fromMarkdown(`---
who: Alice
rel: []
---
Content`)
  assert({
    given: 'doc with empty rel array',
    should: 'not throw and check other fields',
    actual: matchesInvolves(doc, 'Alice'),
    expected: true,
  })
})

test('matchesInvolves - rel iteration is null-safe', () => {
  const doc = Document.fromMarkdown(`---
who: Bob
rel:
  - Alice
---
Content`)
  assert({
    given: 'doc with valid rel entries',
    should: 'match name in rel',
    actual: matchesInvolves(doc, 'Alice'),
    expected: true,
  })
})

test('matchesInvolves - handles non-string rel values', () => {
  // Regression: rel containing numbers or other non-string values
  // would cause "r.toLowerCase is not a function" error
  const doc = Document.fromMarkdown(`---
who: Alice
rel:
  - 123
  - projects/Foo
---
Content`)
  assert({
    given: 'doc with numeric rel entry',
    should: 'not throw and check string entries',
    actual: matchesInvolves(doc, 'Foo'),
    expected: true,
  })
})

// =============================================================================
// Name Resolution (PeopleStore aliases)
// =============================================================================

const mockResolver: NameResolver = (name: string) => {
  const aliases: Record<string, string[]> = {
    jw: ['James Robert Wheeler', 'JW', 'Jim Wheeler'],
    'james robert wheeler': ['James Robert Wheeler', 'JW', 'Jim Wheeler'],
    'jim wheeler': ['James Robert Wheeler', 'JW', 'Jim Wheeler'],
  }
  return aliases[name.toLowerCase()] ?? [name]
}

const resolverFixtures = [
  { yaml: 'from: Jim Wheeler', name: 'JW', expected: true, description: 'nickname resolves to full name in from' },
  { yaml: 'from: JW', name: 'Jim Wheeler', expected: true, description: 'full name resolves to nickname in from' },
  {
    yaml: 'who: James Robert Wheeler',
    name: 'JW',
    expected: true,
    description: 'nickname resolves to legal name in who',
  },
  { yaml: 'to: Jim Wheeler', name: 'JW', expected: true, description: 'nickname resolves to full name in to' },
  { yaml: 'from: Someone Else', name: 'JW', expected: false, description: 'resolver does not match unrelated person' },
  {
    yaml: 'from: Jim Wheeler',
    name: 'Unknown',
    expected: false,
    description: 'unknown name falls back to literal match',
  },
]

for (const { yaml, name, expected, description } of resolverFixtures) {
  test(`matchesInvolves with resolver - ${description}`, () => {
    const doc = md(yaml)
    assert({
      given: description,
      should: expected ? 'match' : 'not match',
      actual: matchesInvolves(doc, name, mockResolver),
      expected,
    })
  })
}
