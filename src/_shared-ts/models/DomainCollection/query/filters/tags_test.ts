import { Document } from '#shared/models/Markdown/mod.ts'
import { assert, test } from '#test'
import { matchesTagContains, matchesTagContainsAll, matchesTagContainsAny, matchesTagPrefix } from './tags.ts'

function md(yaml: string): Document {
  return Document.fromMarkdown(`---\n${yaml}\n---\n`)
}

// =============================================================================
// matchesTagPrefix
// =============================================================================

const prefixFixtures = [
  { tags: 'tags:\n  - Acme/M&A\n  - Finance', prefix: 'Acme/', expected: true, description: 'has matching prefix' },
  { tags: 'tags:\n  - Finance\n  - Legal', prefix: 'Acme/', expected: false, description: 'no matching prefix' },
  { tags: 'tags: []', prefix: 'Acme/', expected: false, description: 'empty tags' },
  { tags: 'tags:\n  - Acme/M&A', prefix: 'acme/', expected: true, description: 'prefix cased differently' },
  { tags: 'tags:\n  - acme/m&a', prefix: 'Acme/', expected: true, description: 'tag cased differently' },
  { tags: 'tags:\n  - Acme', prefix: 'Acme/', expected: true, description: 'namespace root is in its namespace' },
  { tags: 'tags:\n  - Acme', prefix: 'Acme', expected: true, description: 'namespace root, slashless prefix' },
  { tags: 'tags:\n  - Acmes', prefix: 'Acme/', expected: false, description: 'tag sharing a leading substring' },
  { tags: 'tags:\n  - Acme/M&A', prefix: 'Acme/M&A/', expected: true, description: 'nested namespace root' },
  { tags: 'tags:\n  - Acme/M&A', prefix: 'Acme/M&A/EU/', expected: false, description: 'prefix deeper than the tag' },
]

for (const { tags, prefix, expected, description } of prefixFixtures) {
  test(`matchesTagPrefix - ${description}`, () => {
    const doc = md(tags)
    assert({
      given: description,
      should: expected ? 'match' : 'not match',
      actual: matchesTagPrefix(doc, prefix),
      expected,
    })
  })
}

// =============================================================================
// matchesTagContains
// =============================================================================

const containsFixtures = [
  { tags: 'tags:\n  - Finance\n  - Legal', tag: 'Finance', expected: true, description: 'has tag' },
  { tags: 'tags:\n  - Finance\n  - Legal', tag: 'HR', expected: false, description: 'missing tag' },
  { tags: 'tags:\n  - Finance', tag: 'finance', expected: true, description: 'query cased differently' },
  { tags: 'tags:\n  - FINANCE', tag: 'Finance', expected: true, description: 'stored tag cased differently' },
]

for (const { tags, tag, expected, description } of containsFixtures) {
  test(`matchesTagContains - ${description}`, () => {
    const doc = md(tags)
    assert({
      given: description,
      should: expected ? 'match' : 'not match',
      actual: matchesTagContains(doc, tag),
      expected,
    })
  })
}

// =============================================================================
// matchesTagContainsAny
// =============================================================================

const containsAnyFixtures = [
  { tags: 'tags:\n  - Finance\n  - Legal', search: ['Finance', 'HR'], expected: true, description: 'one tag matches' },
  {
    tags: 'tags:\n  - Finance\n  - Legal',
    search: ['Finance', 'Legal'],
    expected: true,
    description: 'both tags match',
  },
  { tags: 'tags:\n  - Finance\n  - Legal', search: ['HR', 'Sales'], expected: false, description: 'no tags match' },
  { tags: 'tags: []', search: ['Finance'], expected: false, description: 'empty tags' },
  { tags: 'tags:\n  - Finance', search: [], expected: false, description: 'empty search list' },
  {
    tags: 'tags:\n  - Finance\n  - Legal',
    search: ['FINANCE', 'HR'],
    expected: true,
    description: 'matching tag cased differently',
  },
]

for (const { tags, search, expected, description } of containsAnyFixtures) {
  test(`matchesTagContainsAny - ${description}`, () => {
    const doc = md(tags)
    assert({
      given: description,
      should: expected ? 'match' : 'not match',
      actual: matchesTagContainsAny(doc, search),
      expected,
    })
  })
}

// =============================================================================
// matchesTagContainsAll
// =============================================================================

const containsAllFixtures = [
  {
    tags: 'tags:\n  - Finance\n  - Legal',
    search: ['Finance', 'Legal'],
    expected: true,
    description: 'all tags present',
  },
  { tags: 'tags:\n  - Finance\n  - Legal', search: ['Finance'], expected: true, description: 'single tag present' },
  { tags: 'tags:\n  - Finance\n  - Legal', search: ['Finance', 'HR'], expected: false, description: 'one tag missing' },
  { tags: 'tags: []', search: ['Finance'], expected: false, description: 'empty tags' },
  { tags: 'tags:\n  - Finance', search: [], expected: true, description: 'empty search list (vacuous truth)' },
  {
    tags: 'tags:\n  - Finance\n  - Legal',
    search: ['finance', 'LEGAL'],
    expected: true,
    description: 'all tags present, cased differently',
  },
]

for (const { tags, search, expected, description } of containsAllFixtures) {
  test(`matchesTagContainsAll - ${description}`, () => {
    const doc = md(tags)
    assert({
      given: description,
      should: expected ? 'match' : 'not match',
      actual: matchesTagContainsAll(doc, search),
      expected,
    })
  })
}
