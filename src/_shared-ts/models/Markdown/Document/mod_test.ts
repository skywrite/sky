import { assert, test } from '#test'
import * as marked from 'marked'
import Document from '#shared/models/Markdown/Document/mod.ts'
import TagSet from '#shared/models/TagSet/mod.ts'

test('Document.fromMarkdown - parses YAML frontmatter', () => {
  const markdown = `---
title: Test Document
author: John Doe
date: 2025-07-31
tags: test, documentation
---

# Test Document

This is a test document.`

  const doc = Document.fromMarkdown(markdown)

  assert({ actual: doc.yaml.title, expected: 'Test Document' })
  assert({ actual: doc.yaml.author, expected: 'John Doe' })
  // npm:yaml keeps date strings as strings
  assert({ actual: doc.yaml.date, expected: '2025-07-31' })
  assert({ actual: doc.yaml.tags, expected: 'test, documentation' })
  assert({ actual: doc.markdown.includes('# Test Document'), expected: true })
})

test('Document.fromMarkdown - handles empty YAML', () => {
  const markdown = `---
---

# Empty YAML

This document has empty YAML frontmatter.`

  const doc = Document.fromMarkdown(markdown)

  assert({ actual: Object.keys(doc.yaml).length, expected: 0 })
  assert({ actual: doc.markdown.includes('# Empty YAML'), expected: true })
})

test('Document.fromMarkdown - handles no YAML frontmatter', () => {
  const markdown = `# No YAML

This document has no YAML frontmatter.`

  const doc = Document.fromMarkdown(markdown)

  assert({ actual: Object.keys(doc.yaml).length, expected: 0 })
  assert({ actual: doc.markdown.includes('# No YAML'), expected: true })
})

test('Document.fromMarkdown - parses complex YAML structures', () => {
  const markdown = `---
person:
  name: Jane Smith
  email:
    personal: jane@personal.com
    business: jane@work.com
  skills:
    - JavaScript
    - TypeScript
    - Deno
metadata:
  created: 2025-07-31
  modified: 2025-07-31
  version: 1.0
---

# Complex YAML Test`

  const doc = Document.fromMarkdown(markdown)
  const yaml = doc.yaml as any

  assert({ actual: yaml.person?.name, expected: 'Jane Smith' })
  assert({ actual: yaml.person?.email?.personal, expected: 'jane@personal.com' })
  assert({ actual: yaml.person?.email?.business, expected: 'jane@work.com' })
  assert({ actual: Array.isArray(yaml.person?.skills), expected: true })
  assert({ actual: yaml.person?.skills?.length, expected: 3 })
  // npm:yaml keeps date strings as strings
  assert({ actual: yaml.metadata?.created, expected: '2025-07-31' })
  assert({ actual: yaml.metadata?.version, expected: 1.0 })
})

test('Document.toMarkdown - preserves YAML and content', () => {
  const originalMarkdown = `---
title: Roundtrip Test
author: Test Author
tags: test, yaml
---

# Roundtrip Test

This tests that YAML and markdown content are preserved.`

  const doc = Document.fromMarkdown(originalMarkdown)
  const result = doc.toMarkdown()

  assert({ actual: result.includes('title: Roundtrip Test'), expected: true })
  assert({ actual: result.includes('author: Test Author'), expected: true })
  assert({ actual: result.includes('tags: test, yaml'), expected: true })
  assert({ actual: result.includes('# Roundtrip Test'), expected: true })
  assert({ actual: result.includes('This tests that YAML and markdown content are preserved.'), expected: true })
})

test('Document - tags property returns TagSet', () => {
  const markdown = `---
title: Tag Test
tags: work; important; todo
---

# Tag Test`

  const doc = Document.fromMarkdown(markdown)
  const tags = doc.tags

  assert({
    given: 'a document with tags',
    should: 'return a TagSet instance',
    actual: tags instanceof TagSet,
    expected: true,
  })
  assert({ actual: tags.has('work'), expected: true })
  assert({ actual: tags.has('important'), expected: true })
  assert({ actual: tags.has('todo'), expected: true })
})

test('Document.updateYaml - merges YAML data', () => {
  const markdown = `---
title: Original Title
author: Original Author
---

# Content`

  const doc = Document.fromMarkdown(markdown)
  const updated = doc.updateYaml({
    author: 'Updated Author',
    date: '2025-07-31',
  })

  assert({ actual: updated.yaml.title, expected: 'Original Title' })
  assert({ actual: updated.yaml.author, expected: 'Updated Author' })
  assert({ actual: updated.yaml.date, expected: '2025-07-31' })
})

test('Document - handles null values in YAML', () => {
  const markdown = `---
title: Null Test
author: null
email:
tags:
---

# Null Test`

  const doc = Document.fromMarkdown(markdown)

  assert({ actual: doc.yaml.title, expected: 'Null Test' })
  assert({ actual: doc.yaml.author, expected: null })
  assert({ actual: doc.yaml.email, expected: null })
  assert({ actual: doc.yaml.tags, expected: null })
})

test('Document - markdownTokens are cached across accesses', () => {
  // updateLinks mutates the returned TokensList (markdownTokens.links = …)
  // and relies on the lazy getter returning the same object every time.
  const doc = Document.fromMarkdown('# Title\n\nSome [link][ref] text.\n\n[ref]: https://example.com')

  assert({
    given: 'two accesses of markdownTokens',
    should: 'return the identical cached object',
    actual: doc.markdownTokens === doc.markdownTokens,
    expected: true,
  })
})

test('Document - lazy tokens match a direct marked lex', () => {
  const markdown = '# Heading\n\n- item one\n- item two\n\nA paragraph with **bold**.'
  const doc = Document.fromMarkdown(markdown)

  assert({
    given: 'a lazily-lexed document',
    should: 'produce the same tokens as lexing the markdown directly',
    actual: JSON.stringify(doc.markdownTokens),
    expected: JSON.stringify(marked.lexer(markdown, {})),
  })
})

// ---------------------------------------------------------------------------
// toMarkdown fast path — raw body when tokens were never materialized
// ---------------------------------------------------------------------------

const FAST_PATH_SAMPLES = [
  { desc: 'headings, list and emphasis', body: '# Title\n\n- one\n- two\n\nA paragraph with **bold** text.' },
  { desc: 'fenced code and blockquote', body: '```ts\nconst x = 1\n```\n\n> quoted line\n' },
  { desc: 'reference links', body: 'See [docs][ref] for details.\n\n[ref]: https://example.com' },
  { desc: 'table', body: '| a | b |\n| --- | --- |\n| 1 | 2 |\n' },
  { desc: 'task list', body: '- [ ] todo item\n- [x] done item\n' },
  { desc: 'empty body', body: '' },
]

FAST_PATH_SAMPLES.forEach(({ desc, body }) => {
  test(`Document - toMarkdown fast path matches token render: ${desc}`, () => {
    const markdown = `---\ntitle: Sample\n---\n\n${body}`

    const lazy = Document.fromMarkdown(markdown)
    const rendered = Document.fromMarkdown(markdown)
    rendered.markdownTokens // materialize first, forcing the token render path

    assert({
      given: `a document with ${desc}`,
      should: 'produce identical output whether or not tokens were materialized',
      actual: lazy.toMarkdown(),
      expected: rendered.toMarkdown(),
    })
  })
})

test('Document - toMarkdown does not materialize tokens', () => {
  const doc = Document.fromMarkdown('---\ntitle: Sample\n---\n\n# Title\n\nBody text.')
  doc.toMarkdown()

  assert({
    given: 'toMarkdown on an unmaterialized document',
    should: 'leave tokens unlexed',
    actual: doc['_markdownTokens'],
    expected: null,
  })
})

test('Document - clone does not materialize tokens', () => {
  // clone() round-trips through toMarkdown(); before the fast path this
  // lexed the source doc, costing ~16s across the project store at boot.
  const doc = Document.fromMarkdown('---\ntitle: Sample\n---\n\n- item one\n- item two')
  const cloned = doc.clone()

  assert({
    given: 'a cloned document',
    should: 'leave the source tokens unlexed',
    actual: doc['_markdownTokens'],
    expected: null,
  })

  assert({
    given: 'a cloned document',
    should: 'leave the clone tokens unlexed',
    actual: cloned['_markdownTokens'],
    expected: null,
  })

  assert({
    given: 'a cloned document',
    should: 'preserve content',
    actual: cloned.toMarkdown(),
    expected: doc.toMarkdown(),
  })
})

test('Document - setRel does not materialize tokens', () => {
  // The ProjectStore rel-injection path: mutating yaml must not lex.
  const doc = Document.fromMarkdown('---\ntitle: Sample\n---\n\n# Body')
  const withRel = doc.addRel('projects/Atlas')

  assert({
    given: 'addRel on an unmaterialized document',
    should: 'leave tokens unlexed',
    actual: withRel['_markdownTokens'],
    expected: null,
  })

  assert({
    given: 'addRel',
    should: 'still record the rel',
    actual: Array.from(withRel.rel),
    expected: ['projects/Atlas'],
  })
})

test('Document - reference-link definitions take the token render path', () => {
  // The render relocates definitions to the end of the body, so the raw
  // text can differ — such documents must not take the fast path.
  const body = 'Intro [docs][ref].\n\n[ref]: https://example.com\n\nMore text after.\n'
  const doc = Document.fromMarkdown(`---\ntitle: Sample\n---\n\n${body}`)
  const output = doc.toMarkdown()

  assert({
    given: 'a document with a mid-body link definition',
    should: 'materialize tokens rather than return the raw body',
    actual: doc['_markdownTokens'] !== null,
    expected: true,
  })

  assert({
    given: 'a document with a mid-body link definition',
    should: 'render definitions at the end, as before the fast path',
    actual: output.endsWith('More text after.\n[ref]: https://example.com\n'),
    expected: true,
  })
})

test('Document - toMarkdown({ links: false }) still drops link definitions', () => {
  // links: false must take the token render path — the fast path would
  // return the raw body, definitions included.
  const doc = Document.fromMarkdown('---\ntitle: Sample\n---\n\nSee [docs][ref].\n\n[ref]: https://example.com')

  assert({
    given: 'toMarkdown with links: false',
    should: 'omit the link definition',
    actual: doc.toMarkdown({ links: false }).includes('https://example.com'),
    expected: false,
  })

  assert({
    given: 'toMarkdown with links kept (default)',
    should: 'include the link definition',
    actual: doc.toMarkdown().includes('https://example.com'),
    expected: true,
  })
})
