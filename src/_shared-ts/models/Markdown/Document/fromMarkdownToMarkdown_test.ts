import { assert, loadFixturesSync, test } from '#test'
import Document from '#shared/models/Markdown/Document/mod.ts'

const FIXTURES = loadFixturesSync(import.meta.url)

test('Document: fromMarkdown() / toMarkdown()', function () {
  let given = 'A standard day markdown file '
  const should = 'Should parse and emit the same contents'

  Object.entries(FIXTURES).forEach(([fileName, contents]) => {
    const expected = contents
    const actual = Document.fromMarkdown(expected).toMarkdown()

    console.log(actual)

    given += fileName
    assert({ given, should, expected, actual })
  })
})
