import { Document } from '#shared/models/Markdown/mod.ts'
import { assert, test } from '#test'
import { matchesRelContains, matchesRelPrefix } from './rel.ts'

function md(yaml: string): Document {
  return Document.fromMarkdown(`---\n${yaml}\n---\n`)
}

// =============================================================================
// matchesRelContains
// =============================================================================

const containsFixtures = [
  {
    yaml: 'rel:\n  - projects/Acme-Pay-GTM',
    ref: 'projects/Acme-Pay-GTM',
    expected: true,
    description: 'exact match',
  },
  {
    yaml: 'rel:\n  - projects/Acme-Pay-GTM',
    ref: 'Acme-Pay',
    expected: true,
    description: 'partial match',
  },
  {
    yaml: 'rel:\n  - projects/Acme-Pay-GTM',
    ref: 'acme-pay',
    expected: true,
    description: 'case insensitive',
  },
  {
    yaml: 'rel:\n  - decisions/Hire-CTO\n  - projects/Foo',
    ref: 'decisions/Hire',
    expected: true,
    description: 'multiple rel entries',
  },
  {
    yaml: 'rel:\n  - projects/Other',
    ref: 'Acme-Pay',
    expected: false,
    description: 'no match',
  },
  {
    yaml: 'rel: []',
    ref: 'projects/Foo',
    expected: false,
    description: 'empty rel',
  },
]

for (const { yaml, ref, expected, description } of containsFixtures) {
  test(`matchesRelContains - ${description}`, () => {
    const doc = md(yaml)
    assert({
      given: description,
      should: expected ? 'match' : 'not match',
      actual: matchesRelContains(doc, ref),
      expected,
    })
  })
}

test('matchesRelContains - handles null ref parameter', () => {
  const doc = md('rel:\n  - projects/Foo')
  assert({
    given: 'null ref parameter',
    should: 'return false without throwing',
    actual: matchesRelContains(doc, null as unknown as string),
    expected: false,
  })
})

test('matchesRelContains - handles non-string rel values', () => {
  const doc = Document.fromMarkdown(`---
rel:
  - 123
  - projects/Foo
---
`)
  assert({
    given: 'doc with numeric rel entry',
    should: 'check string entries only',
    actual: matchesRelContains(doc, 'Foo'),
    expected: true,
  })
})

// =============================================================================
// matchesRelPrefix
// =============================================================================

const prefixFixtures = [
  {
    yaml: 'rel:\n  - projects/Acme-Pay-GTM',
    prefix: 'projects/',
    expected: true,
    description: 'projects prefix',
  },
  {
    yaml: 'rel:\n  - decisions/Hire-CTO',
    prefix: 'decisions/',
    expected: true,
    description: 'decisions prefix',
  },
  {
    yaml: 'rel:\n  - Alice Smith',
    prefix: 'projects/',
    expected: false,
    description: 'no matching prefix',
  },
  {
    yaml: 'rel:\n  - projects/Foo\n  - decisions/Bar',
    prefix: 'decisions/',
    expected: true,
    description: 'multiple rel with match',
  },
]

for (const { yaml, prefix, expected, description } of prefixFixtures) {
  test(`matchesRelPrefix - ${description}`, () => {
    const doc = md(yaml)
    assert({
      given: description,
      should: expected ? 'match' : 'not match',
      actual: matchesRelPrefix(doc, prefix),
      expected,
    })
  })
}
