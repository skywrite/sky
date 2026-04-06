import { assert, loadFixturesSync, test } from '#test'
import ListDocument from '#shared/models/Markdown/ListDocument/mod.ts'
import ItemList from '#shared/models/Markdown/ItemList/mod.ts'

const FIXTURES = loadFixturesSync(import.meta.url)

test(`ItemList.concat - regression with links`, function () {
  const given = 'An ItemList with links'
  const should = 'Should concat the correct number of links'

  const source = FIXTURES['next-with-links.md']

  const doc = ListDocument.fromMarkdown(source)

  const list1 = doc.lists.find((list) => list.title === 'Next 1')
  if (!list1) throw new Error('Cannot find list.')

  const list2 = doc.lists.find((list) => list.title === 'Next 2')
  if (!list2) throw new Error('Cannot find list.')

  const listNew = list1?.concat(list2, { title: 'Next New' })

  // for now, hardcode the actual number
  // in case I change the fixture file I don't silently break the test

  assert({ given, should, expected: 3, actual: listNew.links.size })
})
