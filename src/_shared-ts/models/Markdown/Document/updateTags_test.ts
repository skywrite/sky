import { assert, loadFixturesSync, test } from '#test'
import Document from '#shared/models/Markdown/Document/mod.ts'

const FIXTURES = loadFixturesSync(import.meta.url)

test('Document: updateTags', function () {
  const given = 'A standard day markdown file and tags to update'
  const should = 'Update tags'

  const markdownContents = FIXTURES['2022-12-30_day.md']
  const baseDoc = Document.fromMarkdown(markdownContents)

  const expected = 'Test; Marcom'
  const actual = baseDoc.updateTags(baseDoc.tags.replace('Marketing', 'Marcom')).tags.toString()

  assert({ given, should, expected, actual })
})
