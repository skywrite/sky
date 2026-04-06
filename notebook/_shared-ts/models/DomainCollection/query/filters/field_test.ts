import { assert, test } from '#test'
import { Document } from '#shared/models/Markdown/mod.ts'
import { matchesContains, matchesExact, matchesNull, matchesPrefix, matchesSubstring, matchesSuffix } from './field.ts'

function md(yaml: string): Document {
  return Document.fromMarkdown(`---\n${yaml}\n---\n`)
}

// =============================================================================
// matchesExact
// =============================================================================

const exactFixtures = [
  { yaml: 'medium: Zoom', field: 'medium', value: 'Zoom', expected: true, description: 'string match' },
  { yaml: 'medium: Phone', field: 'medium', value: 'Zoom', expected: false, description: 'string no match' },
  { yaml: 'year: 2025', field: 'year', value: 2025, expected: true, description: 'number match' },
  { yaml: 'year: 2025', field: 'year', value: 2024, expected: false, description: 'number no match' },
  { yaml: 'perfect: true', field: 'perfect', value: true, expected: true, description: 'boolean match' },
]

for (const { yaml, field, value, expected, description } of exactFixtures) {
  test(`matchesExact - ${description}`, () => {
    const doc = md(yaml)
    assert({
      given: description,
      should: expected ? 'match' : 'not match',
      actual: matchesExact(doc, field, value),
      expected,
    })
  })
}

// =============================================================================
// matchesContains
// =============================================================================

const containsFixtures = [
  {
    yaml: 'who:\n  - Alice Smith\n  - Bob Jones',
    field: 'who',
    value: 'Alice',
    expected: true,
    description: 'array contains',
  },
  { yaml: 'who: Alice, Bob', field: 'who', value: 'Bob', expected: true, description: 'comma-separated contains' },
  { yaml: 'tags:\n  - Finance', field: 'tags', value: 'Finance', expected: true, description: 'tags contains' },
  { yaml: 'rel:\n  - projects/Foo', field: 'rel', value: 'projects/Foo', expected: true, description: 'rel contains' },
]

for (const { yaml, field, value, expected, description } of containsFixtures) {
  test(`matchesContains - ${description}`, () => {
    const doc = md(yaml)
    assert({
      given: description,
      should: expected ? 'match' : 'not match',
      actual: matchesContains(doc, field, value),
      expected,
    })
  })
}

test('matchesContains - handles null value parameter', () => {
  const doc = md('who: Alice Smith')
  assert({
    given: 'null value parameter',
    should: 'return false without throwing',
    actual: matchesContains(doc, 'who', null as unknown as string),
    expected: false,
  })
})

test('matchesContains - handles null field value in doc', () => {
  const doc = md('name: Alice')
  assert({
    given: 'field that does not exist',
    should: 'return false without throwing',
    actual: matchesContains(doc, 'who', 'Alice'),
    expected: false,
  })
})

// =============================================================================
// matchesPrefix
// =============================================================================

const prefixFixtures = [
  { yaml: 'tags:\n  - Acme/M&A', field: 'tags', prefix: 'Acme/', expected: true, description: 'tags field' },
  {
    yaml: 'summary: Partnership discussion with Acme',
    field: 'summary',
    prefix: 'Partnership',
    expected: true,
    description: 'string field',
  },
]

for (const { yaml, field, prefix, expected, description } of prefixFixtures) {
  test(`matchesPrefix - ${description}`, () => {
    const doc = md(yaml)
    assert({
      given: description,
      should: expected ? 'match' : 'not match',
      actual: matchesPrefix(doc, field, prefix),
      expected,
    })
  })
}

// =============================================================================
// matchesSuffix
// =============================================================================

const suffixFixtures = [
  { yaml: 'name: Alice Smith', field: 'name', suffix: 'Smith', expected: true, description: 'string field match' },
  { yaml: 'name: Alice Smith', field: 'name', suffix: 'Jones', expected: false, description: 'no match' },
]

for (const { yaml, field, suffix, expected, description } of suffixFixtures) {
  test(`matchesSuffix - ${description}`, () => {
    const doc = md(yaml)
    assert({
      given: description,
      should: expected ? 'match' : 'not match',
      actual: matchesSuffix(doc, field, suffix),
      expected,
    })
  })
}

// =============================================================================
// matchesSubstring
// =============================================================================

const substringFixtures = [
  {
    yaml: 'summary: Discussion about partnership strategy',
    field: 'summary',
    substring: 'partnership',
    expected: true,
    description: 'string field',
  },
  {
    yaml: 'summary: Discussion about Partnership strategy',
    field: 'summary',
    substring: 'partnership',
    expected: true,
    description: 'case insensitive',
  },
]

for (const { yaml, field, substring, expected, description } of substringFixtures) {
  test(`matchesSubstring - ${description}`, () => {
    const doc = md(yaml)
    assert({
      given: description,
      should: expected ? 'match' : 'not match',
      actual: matchesSubstring(doc, field, substring),
      expected,
    })
  })
}

test('matchesSubstring - handles null substring parameter', () => {
  const doc = md('summary: Discussion')
  assert({
    given: 'null substring parameter',
    should: 'return false without throwing',
    actual: matchesSubstring(doc, 'summary', null as unknown as string),
    expected: false,
  })
})

test('matchesSubstring - handles null field value', () => {
  const doc = md('name: Alice')
  assert({
    given: 'field that does not exist',
    should: 'return false without throwing',
    actual: matchesSubstring(doc, 'summary', 'test'),
    expected: false,
  })
})

// =============================================================================
// matchesNull
// =============================================================================

const nullFixtures = [
  { yaml: 'name: Alice', field: 'org', expected: true, description: 'field missing' },
  { yaml: 'name: Alice\norg: MoonPay', field: 'org', expected: false, description: 'field present' },
]

for (const { yaml, field, expected, description } of nullFixtures) {
  test(`matchesNull - ${description}`, () => {
    const doc = md(yaml)
    assert({
      given: description,
      should: expected ? 'match' : 'not match',
      actual: matchesNull(doc, field),
      expected,
    })
  })
}
