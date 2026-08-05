import ListDocument from '#shared/models/Markdown/ListDocument/mod.ts'
import { assert, loadFixturesSync, test } from '#test'

const FIXTURES = loadFixturesSync(import.meta.url)

test('ListDocument.insertItemToList', function () {
  const given = 'A markdown file with lists'
  const should = 'Should replace the list with another using the list title'

  const md1 = FIXTURES['2022-12-30_day_with-items.md']
  const md2 = FIXTURES['2022-12-30_day_with-more-items.md']

  const doc1 = ListDocument.fromMarkdown(md1)
  const doc2 = ListDocument.fromMarkdown(md2)

  const newDoc = doc1
    .insertItem('Personal Commitments', '12:00 > Inbox zero', 0)
    .insertItem('Professional Commitments', '14:00 > Meet w/ Sally', 1)
    .insertItem('Professional Todos', 'reach out to George', 0)
    .insertItem('Professional Todos', 'reach out to Steve', -1)

  const expected = doc2.toMarkdown()
  const actual = newDoc.toMarkdown()

  assert({ given, should, expected, actual })
})
