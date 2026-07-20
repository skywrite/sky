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
