import { assert, loadFixturesSync, test } from '#test'
import Document from '#shared/models/Markdown/Document/mod.ts'

const FIXTURES = loadFixturesSync(import.meta.url)

test('Document: tags', function () {
  const given = 'A standard day markdown file'
  const should = 'Parse and have a tags property'

  const expected = 'Test; Marketing'
  const actual = String(Document.fromMarkdown(FIXTURES['2022-12-30_day.md']).tags)

  assert({ given, should, expected, actual })
})
