import { assert, loadFixturesSync, test } from '#test'
import ListDocument from '#shared/models/Markdown/ListDocument/mod.ts'

const FIXTURES = loadFixturesSync(import.meta.url)

test(`${ListDocument.name}.addList: list title`, function () {
  const given = 'A standard day markdown file and list title'
  const should = 'Should add a list'

  const source = FIXTURES['2022-12-30_day_no-lists.md']

  const doc = ListDocument.fromMarkdown(source)

  const newDoc = doc
    .addList('Personal Commitments')
    .addList('Personal Complete')
    .addList('Professional Commitments')
    .addList('Professional Complete')

  const expected = FIXTURES['2022-12-30_day.md']
  const actual = newDoc.toMarkdown()

  assert({ given, should, expected, actual })
})

test(`${ListDocument.name}.addList: list`, function () {
  const given = 'A standard day markdown file and list'
  const should = 'Should add a list'

  const source = FIXTURES['2022-12-30_day_no-lists.md']
  const sourceWithList = FIXTURES['2022-12-30_day_with-more-items.md']
  const expected = FIXTURES['2022-12-30_day_with-one-list.md']

  const docSource = ListDocument.fromMarkdown(source)
  const docSourceWithList = ListDocument.fromMarkdown(sourceWithList)

  const list = docSourceWithList.lists.find((list) => list.title === 'Professional Commitments')
  if (!list) throw new Error(`Cannot find list "Professional Commitments"`)

  const newDoc = docSource.addList(list)

  const actual = newDoc.toMarkdown()

  assert({ given, should, expected, actual })
})
