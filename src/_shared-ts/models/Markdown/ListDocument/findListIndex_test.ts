import ListDocument from '#shared/models/Markdown/ListDocument/mod.ts'
import { assert, test } from '#test'

const BASE_DOC_NO_LISTS = `---
tags: Test
---

# **2022-12-30 - Fri**
`

const BASE_DOC_THREE_LISTS = `---
tags: Test
---

# **2022-12-30 - Fri**

## Alpha Todos
- alpha item

## Beta Commitments
- beta item

## Gamma Todos
- gamma item
`

const BASE_DOC_FIVE_LISTS = `---
tags: Test
---

# **2022-12-30 - Fri**

## Personal Commitments
- item 1

## Personal Todos
- item 2

## Work Commitments
- item 3

## Work Todos
- item 4

## Complete
- item 5
`

// findListIndex fixtures
const findListIndexFixtures = [
  {
    description: 'finds first list matching predicate',
    source: BASE_DOC_THREE_LISTS,
    predicate: (l: { title: string }) => l.title.endsWith('Todos'),
    expected: 0,
  },
  {
    description: 'finds list by exact title',
    source: BASE_DOC_THREE_LISTS,
    predicate: (l: { title: string }) => l.title === 'Beta Commitments',
    expected: 1,
  },
  {
    description: 'returns -1 when no match found',
    source: BASE_DOC_THREE_LISTS,
    predicate: (l: { title: string }) => l.title === 'Nonexistent',
    expected: -1,
  },
  {
    description: 'returns -1 for empty document',
    source: BASE_DOC_NO_LISTS,
    predicate: (l: { title: string }) => l.title.endsWith('Todos'),
    expected: -1,
  },
  {
    description: 'finds first Todos in five-list document',
    source: BASE_DOC_FIVE_LISTS,
    predicate: (l: { title: string }) => l.title.endsWith('Todos'),
    expected: 1,
  },
]

findListIndexFixtures.forEach((fixture) => {
  test(`findListIndex - ${fixture.description}`, () => {
    const doc = ListDocument.fromMarkdown(fixture.source)
    const actual = doc.findListIndex(fixture.predicate)

    assert({
      given: fixture.description,
      should: `return index ${fixture.expected}`,
      actual,
      expected: fixture.expected,
    })
  })
})

// findLastListIndex fixtures
const findLastListIndexFixtures = [
  {
    description: 'finds last list matching predicate',
    source: BASE_DOC_THREE_LISTS,
    predicate: (l: { title: string }) => l.title.endsWith('Todos'),
    expected: 2,
  },
  {
    description: 'finds list by exact title (same as findListIndex for unique)',
    source: BASE_DOC_THREE_LISTS,
    predicate: (l: { title: string }) => l.title === 'Beta Commitments',
    expected: 1,
  },
  {
    description: 'returns -1 when no match found',
    source: BASE_DOC_THREE_LISTS,
    predicate: (l: { title: string }) => l.title === 'Nonexistent',
    expected: -1,
  },
  {
    description: 'returns -1 for empty document',
    source: BASE_DOC_NO_LISTS,
    predicate: (l: { title: string }) => l.title.endsWith('Todos'),
    expected: -1,
  },
  {
    description: 'finds last Todos in five-list document',
    source: BASE_DOC_FIVE_LISTS,
    predicate: (l: { title: string }) => l.title.endsWith('Todos'),
    expected: 3,
  },
  {
    description: 'finds last Commitments in five-list document',
    source: BASE_DOC_FIVE_LISTS,
    predicate: (l: { title: string }) => l.title.endsWith('Commitments'),
    expected: 2,
  },
]

findLastListIndexFixtures.forEach((fixture) => {
  test(`findLastListIndex - ${fixture.description}`, () => {
    const doc = ListDocument.fromMarkdown(fixture.source)
    const actual = doc.findLastListIndex(fixture.predicate)

    assert({
      given: fixture.description,
      should: `return index ${fixture.expected}`,
      actual,
      expected: fixture.expected,
    })
  })
})

// Test that findListIndex and findLastListIndex return same result for unique match
test('findListIndex vs findLastListIndex - same result for unique match', () => {
  const doc = ListDocument.fromMarkdown(BASE_DOC_FIVE_LISTS)
  const predicate = (l: { title: string }) => l.title === 'Complete'

  const firstIndex = doc.findListIndex(predicate)
  const lastIndex = doc.findLastListIndex(predicate)

  assert({
    given: 'a predicate that matches exactly one list',
    should: 'return same index from both methods',
    actual: firstIndex,
    expected: lastIndex,
  })
})

// Test that findListIndex and findLastListIndex return different results for multiple matches
test('findListIndex vs findLastListIndex - different results for multiple matches', () => {
  const doc = ListDocument.fromMarkdown(BASE_DOC_FIVE_LISTS)
  const predicate = (l: { title: string }) => l.title.endsWith('Todos')

  const firstIndex = doc.findListIndex(predicate)
  const lastIndex = doc.findLastListIndex(predicate)

  assert({
    given: 'a predicate that matches multiple lists',
    should: 'findListIndex returns first match',
    actual: firstIndex,
    expected: 1,
  })

  assert({
    given: 'a predicate that matches multiple lists',
    should: 'findLastListIndex returns last match',
    actual: lastIndex,
    expected: 3,
  })
})
