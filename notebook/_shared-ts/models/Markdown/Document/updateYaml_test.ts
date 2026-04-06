import { assert, loadFixturesSync, test } from '#test'
import Document from '#shared/models/Markdown/Document/mod.ts'

const FIXTURES = loadFixturesSync(import.meta.url)

test('Document: updateYaml', function () {
  const given = 'A standard day markdown file with yaml to update'
  const should = 'Update yaml'

  const markdownContents = FIXTURES['2022-12-30_day.md']
  const baseDoc = Document.fromMarkdown(markdownContents)

  const newDoc = baseDoc.updateYaml({
    tz: 'America/New_York',
  })

  const expected = FIXTURES['2022-12-30_day_yaml-update.md']
  const actual = newDoc.toMarkdown()

  assert({ given, should, expected, actual })
})
