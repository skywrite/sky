import ListDocument from '#shared/models/Markdown/ListDocument/mod.ts'
import { assert, loadFixturesSync, test } from '#test'

const FIXTURES = loadFixturesSync(import.meta.url)

test(`ItemList.filter - preserves links for kept items`, function () {
  const given = 'An ItemList with items that have reference links'
  const should = 'preserve links for items that pass the filter'

  const source = FIXTURES['filter-with-links.md']
  const doc = ListDocument.fromMarkdown(source)

  const list = doc.lists.find((list) => list.title === 'Todos')
  if (!list) throw new Error('Cannot find list.')

  // Filter to keep only incomplete items (not struck through)
  const isNotDone = (item: string) => !item.startsWith('~~')
  const filtered = list.filter(isNotDone)

  // Should have 2 items (the incomplete ones)
  assert({ given, should: 'keep only incomplete items', expected: 2, actual: filtered.size })

  // Should preserve links for kept items
  assert({ given, should: 'preserve links for kept items', expected: 2, actual: filtered.links.size })
  assert({ given, should: 'have robert link', expected: true, actual: filtered.links.has('robert') })
  assert({ given, should: 'have acme link', expected: true, actual: filtered.links.has('acme') })
})

test(`ItemList.filter - removes links for filtered-out items`, function () {
  const given = 'An ItemList with items that have reference links'
  const should = 'not include links for items that were filtered out'

  const source = FIXTURES['filter-with-links.md']
  const doc = ListDocument.fromMarkdown(source)

  const list = doc.lists.find((list) => list.title === 'Todos')
  if (!list) throw new Error('Cannot find list.')

  // Filter to keep only incomplete items (not struck through)
  const isNotDone = (item: string) => !item.startsWith('~~')
  const filtered = list.filter(isNotDone)

  // Should NOT have the link for the completed item
  assert({ given, should, expected: false, actual: filtered.links.has('amazon') })
})
