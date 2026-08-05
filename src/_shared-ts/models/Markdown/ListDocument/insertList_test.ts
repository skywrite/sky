import ItemList from '#shared/models/Markdown/ItemList/mod.ts'
import ListDocument from '#shared/models/Markdown/ListDocument/mod.ts'
import { assert, test } from '#test'

const BASE_DOC_NO_LISTS = `---
tags: Test
---

# **2022-12-30 - Fri**
`

const BASE_DOC_TWO_LISTS = `---
tags: Test
---

# **2022-12-30 - Fri**

## First
- item 1

## Second
- item 2
`

const BASE_DOC_THREE_LISTS = `---
tags: Test
---

# **2022-12-30 - Fri**

## Alpha
- alpha item

## Beta
- beta item

## Gamma
- gamma item
`

// Fixtures for basic insertion tests
const insertionFixtures = [
  {
    description: 'insert at beginning of two-list document',
    source: BASE_DOC_TWO_LISTS,
    insertIndex: 0,
    listTitle: 'New First',
    expectedOrder: ['New First', 'First', 'Second'],
  },
  {
    description: 'insert at end of two-list document',
    source: BASE_DOC_TWO_LISTS,
    insertIndex: 2,
    listTitle: 'New Last',
    expectedOrder: ['First', 'Second', 'New Last'],
  },
  {
    description: 'insert in middle of two-list document',
    source: BASE_DOC_TWO_LISTS,
    insertIndex: 1,
    listTitle: 'Middle',
    expectedOrder: ['First', 'Middle', 'Second'],
  },
  {
    description: 'insert at index 1 of three-list document',
    source: BASE_DOC_THREE_LISTS,
    insertIndex: 1,
    listTitle: 'Inserted',
    expectedOrder: ['Alpha', 'Inserted', 'Beta', 'Gamma'],
  },
  {
    description: 'insert at index 2 of three-list document',
    source: BASE_DOC_THREE_LISTS,
    insertIndex: 2,
    listTitle: 'Inserted',
    expectedOrder: ['Alpha', 'Beta', 'Inserted', 'Gamma'],
  },
  {
    description: 'insert into empty document (no lists)',
    source: BASE_DOC_NO_LISTS,
    insertIndex: 0,
    listTitle: 'Only List',
    expectedOrder: ['Only List'],
  },
]

insertionFixtures.forEach((fixture) => {
  test(`insertList - ${fixture.description}`, () => {
    const doc = ListDocument.fromMarkdown(fixture.source)
    const newDoc = doc.insertList(fixture.insertIndex, fixture.listTitle)

    const actualOrder = newDoc.lists.map((l) => l.title)

    assert({
      given: fixture.description,
      should: `have lists in order: ${fixture.expectedOrder.join(', ')}`,
      actual: actualOrder,
      expected: fixture.expectedOrder,
    })
  })
})

// Fixtures for index clamping tests
const clampingFixtures = [
  {
    description: 'negative index clamps to 0',
    source: BASE_DOC_TWO_LISTS,
    insertIndex: -5,
    listTitle: 'Clamped',
    expectedOrder: ['Clamped', 'First', 'Second'],
  },
  {
    description: 'index beyond length clamps to end',
    source: BASE_DOC_TWO_LISTS,
    insertIndex: 100,
    listTitle: 'Clamped',
    expectedOrder: ['First', 'Second', 'Clamped'],
  },
  {
    description: 'negative index into empty document',
    source: BASE_DOC_NO_LISTS,
    insertIndex: -1,
    listTitle: 'Only',
    expectedOrder: ['Only'],
  },
  {
    description: 'large index into empty document',
    source: BASE_DOC_NO_LISTS,
    insertIndex: 999,
    listTitle: 'Only',
    expectedOrder: ['Only'],
  },
]

clampingFixtures.forEach((fixture) => {
  test(`insertList clamping - ${fixture.description}`, () => {
    const doc = ListDocument.fromMarkdown(fixture.source)
    const newDoc = doc.insertList(fixture.insertIndex, fixture.listTitle)

    const actualOrder = newDoc.lists.map((l) => l.title)

    assert({
      given: fixture.description,
      should: `have lists in order: ${fixture.expectedOrder.join(', ')}`,
      actual: actualOrder,
      expected: fixture.expectedOrder,
    })
  })
})

// Test inserting with ItemList object instead of string
test('insertList - with ItemList object', () => {
  const doc = ListDocument.fromMarkdown(BASE_DOC_TWO_LISTS)
  const itemList = ItemList.fromArray({ title: 'Inserted' }, ['task 1', 'task 2', 'task 3'])

  const newDoc = doc.insertList(1, itemList)

  assert({
    given: 'an ItemList object with items',
    should: 'insert the list with its items',
    actual: newDoc.lists[1].items,
    expected: ['task 1', 'task 2', 'task 3'],
  })

  assert({
    given: 'an ItemList object',
    should: 'preserve the list title',
    actual: newDoc.lists[1].title,
    expected: 'Inserted',
  })

  assert({
    given: 'insertion at index 1',
    should: 'have correct list order',
    actual: newDoc.lists.map((l) => l.title),
    expected: ['First', 'Inserted', 'Second'],
  })
})

// Note: YAML preservation tests are skipped because the YAML parser
// requires env access that the test sandbox doesn't allow.
// The implementation uses the same pattern as addList which is tested
// with fixture files in addList_test.ts.

// Test immutability
test('insertList - returns new document (immutability)', () => {
  const doc = ListDocument.fromMarkdown(BASE_DOC_TWO_LISTS)
  const newDoc = doc.insertList(1, 'Inserted')

  assert({
    given: 'inserting a list',
    should: 'return a new document instance',
    actual: doc === newDoc,
    expected: false,
  })

  assert({
    given: 'inserting a list',
    should: 'not modify original document list count',
    actual: doc.lists.length,
    expected: 2,
  })

  assert({
    given: 'inserting a list',
    should: 'have new list in returned document',
    actual: newDoc.lists.length,
    expected: 3,
  })
})

// Test chaining multiple insertions
test('insertList - can be chained', () => {
  const doc = ListDocument.fromMarkdown(BASE_DOC_NO_LISTS)

  const newDoc = doc.insertList(0, 'First').insertList(1, 'Second').insertList(2, 'Third')

  assert({
    given: 'chaining multiple insertList calls',
    should: 'have all lists in correct order',
    actual: newDoc.lists.map((l) => l.title),
    expected: ['First', 'Second', 'Third'],
  })
})

// Test that insertList(length, x) behaves like addList(x)
test('insertList at end - equivalent to addList', () => {
  const doc = ListDocument.fromMarkdown(BASE_DOC_TWO_LISTS)

  const viaInsert = doc.insertList(doc.lists.length, 'New')
  const viaAdd = doc.addList('New')

  assert({
    given: 'insertList at index equal to list count',
    should: 'produce same list order as addList',
    actual: viaInsert.lists.map((l) => l.title),
    expected: viaAdd.lists.map((l) => l.title),
  })
})

// Test inserting same list title multiple times
test('insertList - allows duplicate list titles', () => {
  const doc = ListDocument.fromMarkdown(BASE_DOC_TWO_LISTS)

  const newDoc = doc.insertList(0, 'Duplicate').insertList(2, 'Duplicate')

  const titles = newDoc.lists.map((l) => l.title)

  assert({
    given: 'inserting lists with same title',
    should: 'allow duplicate titles',
    actual: titles.filter((t) => t === 'Duplicate').length,
    expected: 2,
  })

  assert({
    given: 'inserting duplicate titles at different positions',
    should: 'have correct order',
    actual: titles,
    expected: ['Duplicate', 'First', 'Duplicate', 'Second'],
  })
})

// Test list count after various operations
const countFixtures = [
  { source: BASE_DOC_NO_LISTS, initialCount: 0, expectedAfterInsert: 1 },
  { source: BASE_DOC_TWO_LISTS, initialCount: 2, expectedAfterInsert: 3 },
  { source: BASE_DOC_THREE_LISTS, initialCount: 3, expectedAfterInsert: 4 },
]

countFixtures.forEach((fixture) => {
  test(`insertList - list count: ${fixture.initialCount} -> ${fixture.expectedAfterInsert}`, () => {
    const doc = ListDocument.fromMarkdown(fixture.source)

    assert({
      given: `a document with ${fixture.initialCount} lists`,
      should: 'have correct initial count',
      actual: doc.lists.length,
      expected: fixture.initialCount,
    })

    const newDoc = doc.insertList(0, 'New')

    assert({
      given: `inserting into document with ${fixture.initialCount} lists`,
      should: `have ${fixture.expectedAfterInsert} lists`,
      actual: newDoc.lists.length,
      expected: fixture.expectedAfterInsert,
    })
  })
})
