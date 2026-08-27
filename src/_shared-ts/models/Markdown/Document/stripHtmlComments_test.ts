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

test('Document.stripHtmlComments() - line-leading inline code is not a fence opener', () => {
  const markdown = ['```json``` is inline code, not a fence opener.', '', '<!-- machine: hidden -->', 'After.'].join(
    '\n',
  )
  const result = Document.fromMarkdown(markdown).stripHtmlComments().toMarkdown()

  assert({
    given: 'a comment after a line-leading ```code``` span (backtick info strings may not contain backticks)',
    should: 'strip the comment instead of treating the rest of the document as fence content',
    actual: [result.includes('machine: hidden'), result.includes('After.')].join(','),
    expected: 'false,true',
  })
})

test('Document.stripHtmlComments() - tilde fence info strings may contain backticks', () => {
  const markdown = ['~~~console `session`', '<!-- keep this fenced sample -->', '~~~'].join('\n')
  const result = Document.fromMarkdown(markdown).stripHtmlComments().toMarkdown()

  assert({
    given: 'a comment inside a tilde fence whose info string contains backticks (legal per CommonMark)',
    should: 'preserve the fenced comment',
    actual: result.includes('keep this fenced sample'),
    expected: true,
  })
})

test('Document.stripHtmlComments() - an unclosed fence runs to the end of the document', () => {
  const markdown = ['```ts', 'const x = 1', '<!-- shielded by the open fence -->'].join('\n')
  const result = Document.fromMarkdown(markdown).stripHtmlComments().toMarkdown()

  assert({
    given: 'a comment after an unclosed fence (CommonMark: the fence extends to end of document)',
    should: 'preserve it as fence content — writers must seal bodies before appending machine comments',
    actual: result.includes('shielded by the open fence'),
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
