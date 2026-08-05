import Document from '#shared/models/Markdown/Document/mod.ts'
import { assert, loadFixturesSync, test } from '#test'

const FIXTURES = loadFixturesSync(import.meta.url)

test('Document: clone()', function () {
  let given = 'A standard day markdown file '
  const should = 'Should clone'

  Object.entries(FIXTURES).forEach(([fileName, contents]) => {
    const doc = Document.fromMarkdown(contents)
    const cloneDoc = doc.clone()

    const expected = contents
    const actual = cloneDoc.toMarkdown()

    given += fileName
    assert({ given, should, expected, actual })
  })
})
