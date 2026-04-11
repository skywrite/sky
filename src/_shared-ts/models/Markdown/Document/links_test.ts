import { assert, loadFixturesSync, test } from '#test'
import Document from '#shared/models/Markdown/Document/mod.ts'

const FIXTURES = loadFixturesSync(import.meta.url)

test('Document: links', function () {
  const given = 'A standard day markdown file'
  const should = 'Parse and links'

  const contents = FIXTURES['2022-12-30_day-with-links.md']
  const doc = Document.fromMarkdown(contents)

  assert({ given, should, expected: 1, actual: doc.links.size })

  const expected = { label: 'super_long_essay', href: 'https://example.com' }
  const actual = doc.links.get('super_long_essay')

  assert({ given, should, expected, actual })
})
