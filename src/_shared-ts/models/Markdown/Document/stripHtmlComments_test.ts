import { assert, loadFixturesSync, test } from '#test'
import Document from './mod.ts'

const FIXTURES = loadFixturesSync(import.meta.url)

test('Document.stripHtmlComments() - removes block and inline comments', () => {
  const markdown = FIXTURES['html-comments.md']
  const stripped = Document.fromMarkdown(markdown).stripHtmlComments()
  const result = stripped.toMarkdown()

  assert({
    given: 'a document with YAML frontmatter and HTML comments',
    should: 'preserve YAML frontmatter',
    actual: stripped.yaml['title'],
    expected: 'Chat Context',
  })

  assert({
    given: 'a document with HTML comments',
    should: 'remove block comment contents',
    actual: result.includes('model: test'),
    expected: false,
  })

  assert({
    given: 'a document with inline HTML comments',
    should: 'remove inline comment contents',
    actual: result.includes('hidden inline metadata'),
    expected: false,
  })

  assert({
    given: 'a document with visible markdown around comments',
    should: 'keep visible markdown content',
    actual: result.includes('Visible text') && result.includes('still visible.'),
    expected: true,
  })
})

test('Document.stripHtmlComments() - preserves comment syntax inside fenced code', () => {
  const markdown = FIXTURES['html-comments-in-code.md']
  const result = Document.fromMarkdown(markdown).stripHtmlComments().toMarkdown()

  assert({
    given: 'a document with comment syntax inside a fenced code block',
    should: 'preserve the fenced code comment',
    actual: result.includes('<!-- keep this sample comment -->'),
    expected: true,
  })

  assert({
    given: 'a document with visible markdown around fenced code',
    should: 'keep visible markdown content',
    actual: result.includes('Before.') && result.includes('After.'),
    expected: true,
  })
})

test('Document.stripHtmlComments() - removes unused reference links from comments', () => {
  const markdown = FIXTURES['html-comments-with-links.md']
  const result = Document.fromMarkdown(markdown).stripHtmlComments().toMarkdown()

  assert({
    given: 'a document with a reference link used outside comments',
    should: 'keep reference links used by visible markdown',
    actual: result.includes('[keep]: https://example.com'),
    expected: true,
  })

  assert({
    given: 'a document with a reference link used only inside comments',
    should: 'remove reference links made unused by stripping comments',
    actual: result.includes('[drop]: https://removed.example.com'),
    expected: false,
  })
})
