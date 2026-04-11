import { assert, loadFixturesSync, test } from '#test'
import ItemList from '#shared/models/Markdown/ItemList/mod.ts'
import ListDocument from '#shared/models/Markdown/ListDocument/mod.ts'

const FIXTURES = loadFixturesSync(import.meta.url)

test('ListDocument.replaceList', function () {
  const given = 'A markdown file with lists'
  const should = 'Should replace the list with another using the list title'

  const md1 = FIXTURES['2022-12-30_day_with-items.md']
  const md2 = FIXTURES['2022-12-30_day_with-more-items.md']

  const doc1 = ListDocument.fromMarkdown(md1)
  const doc2 = ListDocument.fromMarkdown(md2)

  const ndx = doc2.lists.findIndex((list) => list.title === 'Professional Commitments')
  const replacementList = <ItemList>doc2.lists.at(ndx)

  const newDoc = doc1.replaceList('Professional Commitments', replacementList)

  const expected = replacementList.toMarkdown()
  const actual = newDoc.lists.at(ndx)?.toMarkdown()

  assert({ given, should, expected, actual })
})

test('ListDocument.replaceList', function () {
  const given = 'A markdown file with lists'
  const should = 'Should replace the list with another using the list index'

  const md1 = FIXTURES['2022-12-30_day_with-items.md']
  const md2 = FIXTURES['2022-12-30_day_with-more-items.md']

  const doc1 = ListDocument.fromMarkdown(md1)
  const doc2 = ListDocument.fromMarkdown(md2)

  const ndx = doc2.lists.findIndex((list) => list.title === 'Professional Commitments')
  const replacementList = <ItemList>doc2.lists.at(ndx)

  const newDoc = doc1.replaceList(ndx, replacementList)

  const expected = replacementList.toMarkdown()
  const actual = newDoc.lists.at(ndx)?.toMarkdown()

  assert({ given, should, expected, actual })
})
