import Document from '#shared/models/Markdown/Document/mod.ts'
import { assert, test } from '#test'

// Regression: a hand-edited rel list with an empty `- ` item parses as null.
// Typed as ImmutableSet<string>, that null reached every consumer — it crashed
// MarkdownStore.resolve ("Cannot read properties of null"), and over GraphQL
// one such file nulled an entire query response, since rel is [String!]!.

function relOf(frontmatter: string[]): string[] {
  return Array.from(Document.fromMarkdown(['---', ...frontmatter, '---', 'body'].join('\n')).rel)
}

test('Document.rel drops empty list items', () => {
  assert({
    given: 'a rel list with a bare dash',
    should: 'yield only the real refs',
    actual: relOf(['rel:', '  - Jane Doe', '  -', '  - Acme Corp']),
    expected: ['Jane Doe', 'Acme Corp'],
  })
  assert({
    given: 'a rel list of only empty items',
    should: 'yield nothing',
    actual: relOf(['rel:', '  -', '  -']),
    expected: [],
  })
  assert({
    given: 'a whitespace-only entry',
    should: 'drop it — it can never resolve',
    actual: relOf(['rel:', '  - "   "', '  - Jane Doe']),
    expected: ['Jane Doe'],
  })
})

test('Document.rel leaves real values untouched', () => {
  // Filtering type violations is not licence to sanitize content: a trailing
  // `;` or a stray space is hand-edit damage that must stay visible, because
  // silently repairing it hides a file whose exact-match lookups now miss.
  assert({
    given: 'entries carrying damage',
    should: 'pass them through verbatim, no trim',
    actual: relOf(['rel:', '  - "projects/Some-Project;"', '  - " Jane Doe"']),
    expected: ['projects/Some-Project;', ' Jane Doe'],
  })
})

test('Document.rel still reads the scalar form', () => {
  assert({
    given: 'a semicolon-delimited scalar',
    should: 'split it',
    actual: relOf(['rel: Jane Doe; Acme Corp']),
    expected: ['Jane Doe', 'Acme Corp'],
  })
  assert({ given: 'no rel field', should: 'yield nothing', actual: relOf(['title: x']), expected: [] })
})
