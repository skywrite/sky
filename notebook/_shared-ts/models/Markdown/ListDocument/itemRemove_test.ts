import { assert, loadFixturesSync, test } from '#test'
import ListDocument from '#shared/models/Markdown/ListDocument/mod.ts'

const FIXTURES = loadFixturesSync(import.meta.url)

test('ListDocument.removeItem', function () {
  const given = 'A markdown file with lists'
  const should = 'Should replace the list with another using the list title'

  const md1 = FIXTURES['2022-12-30_day_with-items.md']
  const md2 = FIXTURES['2022-12-30_day_with-more-items.md']

  const doc1 = ListDocument.fromMarkdown(md1)
  const doc2 = ListDocument.fromMarkdown(md2)

  const newDoc = doc2
    .removeItem('Personal Commitments', 0)
    .removeItem('Professional Commitments', 1)
    .removeItem('Professional Todos', 0)
    .removeItem('Professional Todos', -1)

  const expected = doc1.toMarkdown()
  const actual = newDoc.toMarkdown()

  assert({ given, should, expected, actual })
})
