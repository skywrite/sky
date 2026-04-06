import { assert, test } from '#test'
import SectionDocument from './mod.ts'

test('SectionDocument: parses simple flat structure', () => {
  const doc = SectionDocument.fromMarkdown(`## Section A

Content A.

## Section B

Content B.
`)
  assert({
    actual: doc.sections.length,
    expected: 2,
  })
  assert({
    actual: doc.sections[0].heading,
    expected: 'Section A',
  })
  assert({
    actual: doc.sections[0].content,
    expected: 'Content A.',
  })
  assert({
    actual: doc.sections[0].children.length,
    expected: 0,
  })
  assert({
    actual: doc.sections[1].heading,
    expected: 'Section B',
  })
})

test('SectionDocument: parses nested structure', () => {
  const doc = SectionDocument.fromMarkdown(`# Title

Intro.

## Section A

Content A.

### Subsection A.1

Detail A.1.

### Subsection A.2

Detail A.2.

## Section B

Content B.
`)
  // Top level is just the H1
  assert({
    actual: doc.sections.length,
    expected: 1,
  })
  assert({
    actual: doc.root?.heading,
    expected: 'Title',
  })
  assert({
    actual: doc.root?.content,
    expected: 'Intro.',
  })

  // H1 has two H2 children
  assert({
    actual: doc.root?.children.length,
    expected: 2,
  })
  assert({
    actual: doc.root?.children[0].heading,
    expected: 'Section A',
  })
  assert({
    actual: doc.root?.children[1].heading,
    expected: 'Section B',
  })

  // Section A has two H3 children
  assert({
    actual: doc.root?.children[0].children.length,
    expected: 2,
  })
  assert({
    actual: doc.root?.children[0].children[0].heading,
    expected: 'Subsection A.1',
  })
  assert({
    actual: doc.root?.children[0].children[1].heading,
    expected: 'Subsection A.2',
  })
})

test('SectionDocument: handles empty content', () => {
  const doc = SectionDocument.fromMarkdown(`## Empty Section

## Next Section

Has content.
`)
  assert({
    actual: doc.sections.length,
    expected: 2,
  })
  assert({
    actual: doc.sections[0].content,
    expected: '',
  })
  assert({
    actual: doc.sections[1].content,
    expected: 'Has content.',
  })
})

test('SectionDocument: handles YAML frontmatter', () => {
  const doc = SectionDocument.fromMarkdown(`---
title: My Doc
tags: test
---

## Section

Content.
`)
  assert({
    actual: doc.yaml['title'],
    expected: 'My Doc',
  })
  assert({
    actual: doc.sections.length,
    expected: 1,
  })
  assert({
    actual: doc.sections[0].heading,
    expected: 'Section',
  })
})

test('SectionDocument: root returns null when no H1', () => {
  const doc = SectionDocument.fromMarkdown(`## Section

Content.
`)
  assert({
    actual: doc.root,
    expected: null,
  })
})

test('SectionDocument: getSectionsAtLevel returns flat list', () => {
  const doc = SectionDocument.fromMarkdown(`# Title

Intro.

## Section A

Content A.

### Subsection A.1

Detail A.1.

### Subsection A.2

Detail A.2.

## Section B

Content B.
`)
  const h2s = doc.getSectionsAtLevel(2)
  assert({
    actual: h2s.length,
    expected: 2,
  })
  assert({
    actual: h2s[0].heading,
    expected: 'Section A',
  })
  assert({
    actual: h2s[1].heading,
    expected: 'Section B',
  })

  const h3s = doc.getSectionsAtLevel(3)
  assert({
    actual: h3s.length,
    expected: 2,
  })
  assert({
    actual: h3s[0].heading,
    expected: 'Subsection A.1',
  })
  assert({
    actual: h3s[1].heading,
    expected: 'Subsection A.2',
  })
})

test('SectionDocument: getAllSections returns depth-first traversal', () => {
  const doc = SectionDocument.fromMarkdown(`# Title

Intro.

## Section A

Content A.

### Subsection A.1

Detail A.1.

### Subsection A.2

Detail A.2.

## Section B

Content B.
`)
  const all = doc.getAllSections()
  assert({
    actual: all.length,
    expected: 5, // Title, Section A, A.1, A.2, Section B
  })
  assert({
    actual: all.map((s) => s.heading),
    expected: ['Title', 'Section A', 'Subsection A.1', 'Subsection A.2', 'Section B'],
  })
})

test('SectionDocument: findSection finds by predicate', () => {
  const doc = SectionDocument.fromMarkdown(`# Title

## Section A

### Subsection A.2

Content.
`)
  const found = doc.findSection((s) => s.heading.includes('A.2'))
  assert({
    actual: found?.heading,
    expected: 'Subsection A.2',
  })

  const notFound = doc.findSection((s) => s.heading === 'Nonexistent')
  assert({
    actual: notFound,
    expected: undefined,
  })
})
