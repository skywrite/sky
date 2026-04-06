import { assert, test } from '#test'
import Document from './mod.ts'

test('Document.filterSections() - exclude single h2 section', () => {
  const markdown = `---
title: Video Notes
---

# Video Title

## Summary
This is the summary.

## Transcript
This is the transcript.
We don't want this.

## Comments
Some comments here.
`

  const doc = Document.fromMarkdown(markdown)
  const filtered = doc.filterSections((heading) => {
    return !heading.text.toLowerCase().includes('transcript')
  })

  const result = filtered.toMarkdown()

  assert({
    given: 'a document with Summary, Transcript, and Comments sections',
    should: 'exclude only the Transcript section',
    actual: result.includes('Transcript'),
    expected: false,
  })

  assert({
    given: 'a document with Summary, Transcript, and Comments sections',
    should: 'keep the Summary section',
    actual: result.includes('Summary') && result.includes('This is the summary'),
    expected: true,
  })

  assert({
    given: 'a document with Summary, Transcript, and Comments sections',
    should: 'keep the Comments section',
    actual: result.includes('Comments') && result.includes('Some comments'),
    expected: true,
  })

  assert({
    given: 'a document with Summary, Transcript, and Comments sections',
    should: 'preserve YAML frontmatter',
    actual: result.includes('title: Video Notes'),
    expected: true,
  })
})

test('Document.filterSections() - handle nested headings', () => {
  const markdown = `# Main Title

## Keep This
Content to keep.

### Nested Keep
Nested content.

## Remove This
Content to remove.

### Nested Remove
Also remove this nested content.

## Keep This Too
More content to keep.
`

  const doc = Document.fromMarkdown(markdown)
  const filtered = doc.filterSections((heading) => {
    return !heading.text.includes('Remove')
  })

  const result = filtered.toMarkdown()

  assert({
    given: 'a document with nested headings under a removed section',
    should: 'remove the h3 nested under removed h2',
    actual: result.includes('Nested Remove'),
    expected: false,
  })

  assert({
    given: 'a document with nested headings under a kept section',
    should: 'keep the h3 nested under kept h2',
    actual: result.includes('Nested Keep'),
    expected: true,
  })

  assert({
    given: 'a document with h2 sections to keep',
    should: 'keep all non-removed h2 sections',
    actual: result.includes('Keep This') && result.includes('Keep This Too'),
    expected: true,
  })
})

test('Document.filterSections() - handle reference links', () => {
  const markdown = `## Section One
Check out [this link][link1].

## Section Two
And [this other link][link2].

[link1]: https://example.com
[link2]: https://removed.com
`

  const doc = Document.fromMarkdown(markdown)
  const filtered = doc.filterSections((heading) => {
    return heading.text !== 'Section Two'
  })

  const result = filtered.toMarkdown()

  assert({
    given: 'a document with reference links in filtered section',
    should: 'keep links from kept sections',
    actual: result.includes('[link1]: https://example.com'),
    expected: true,
  })

  assert({
    given: 'a document with reference links in filtered section',
    should: 'remove links from removed sections',
    actual: result.includes('[link2]: https://removed.com'),
    expected: false,
  })
})

test('Document.filterSections() - filter multiple sections', () => {
  const markdown = `## Alpha
Content A

## Beta
Content B

## Gamma
Content G

## Delta
Content D
`

  const doc = Document.fromMarkdown(markdown)
  const filtered = doc.filterSections((heading) => {
    return heading.text === 'Alpha' || heading.text === 'Gamma'
  })

  const result = filtered.toMarkdown()

  assert({
    given: 'a document with multiple sections',
    should: 'keep only Alpha section',
    actual: result.includes('Alpha') && result.includes('Content A'),
    expected: true,
  })

  assert({
    given: 'a document with multiple sections',
    should: 'remove Beta section',
    actual: result.includes('Beta'),
    expected: false,
  })

  assert({
    given: 'a document with multiple sections',
    should: 'keep only Gamma section',
    actual: result.includes('Gamma') && result.includes('Content G'),
    expected: true,
  })

  assert({
    given: 'a document with multiple sections',
    should: 'remove Delta section',
    actual: result.includes('Delta'),
    expected: false,
  })
})

test('Document.filterSections() - document with no headings', () => {
  const markdown = `Just some plain text.
No headings here.
`

  const doc = Document.fromMarkdown(markdown)
  const filtered = doc.filterSections(() => false) // Filter out all headings (none exist)

  const result = filtered.toMarkdown()

  assert({
    given: 'a document with no headings',
    should: 'keep all content when no headings to filter',
    actual: result.includes('Just some plain text'),
    expected: true,
  })
})

test('Document.filterSections() - filter all sections', () => {
  const markdown = `## Section One
Content 1

## Section Two
Content 2
`

  const doc = Document.fromMarkdown(markdown)
  const filtered = doc.filterSections(() => false) // Filter out all headings

  const result = filtered.toMarkdown()

  assert({
    given: 'a document where all sections are filtered out',
    should: 'result in empty or minimal content',
    actual: !result.includes('Section One') && !result.includes('Section Two'),
    expected: true,
  })

  assert({
    given: 'a document where all sections are filtered out',
    should: 'remove all section content',
    actual: !result.includes('Content 1') && !result.includes('Content 2'),
    expected: true,
  })
})

test('Document.filterSections() - preserve content before first heading', () => {
  const markdown = `Some introductory text before any headings.

## First Section
Section content.

## Second Section
More content.
`

  const doc = Document.fromMarkdown(markdown)
  const filtered = doc.filterSections((heading) => heading.text === 'First Section')

  const result = filtered.toMarkdown()

  assert({
    given: 'a document with content before first heading',
    should: 'preserve the intro text',
    actual: result.includes('Some introductory text'),
    expected: true,
  })

  assert({
    given: 'a document with filtered sections',
    should: 'keep First Section',
    actual: result.includes('First Section'),
    expected: true,
  })

  assert({
    given: 'a document with filtered sections',
    should: 'remove Second Section',
    actual: result.includes('Second Section'),
    expected: false,
  })
})

test('Document.filterSections() - preserve YAML frontmatter fields', () => {
  const markdown = `---
title: Weekly Update
tags: work, engineering, team
created: 2024-01-15
updated: 2024-01-20
author: John Doe
---

## Accomplishments
- Completed feature X
- Fixed bug Y

## Transcript
This is a long transcript we don't want.

## Next Steps
- Start feature Z
`

  const doc = Document.fromMarkdown(markdown)
  const filtered = doc.filterSections((heading) => {
    return !heading.text.includes('Transcript')
  })

  assert({
    given: 'a document with YAML frontmatter',
    should: 'preserve title field',
    actual: filtered.yaml['title'],
    expected: 'Weekly Update',
  })

  assert({
    given: 'a document with YAML frontmatter',
    should: 'preserve tags field',
    actual: filtered.yaml['tags'],
    expected: 'work, engineering, team',
  })

  assert({
    given: 'a document with YAML frontmatter',
    should: 'preserve created field',
    actual: filtered.yaml['created'],
    expected: '2024-01-15',
  })

  assert({
    given: 'a document with YAML frontmatter',
    should: 'preserve updated field',
    actual: filtered.yaml['updated'],
    expected: '2024-01-20',
  })

  assert({
    given: 'a document with YAML frontmatter',
    should: 'preserve author field',
    actual: filtered.yaml['author'],
    expected: 'John Doe',
  })

  assert({
    given: 'a document with filtered sections',
    should: 'exclude Transcript section',
    actual: filtered.toMarkdown().includes('Transcript'),
    expected: false,
  })

  assert({
    given: 'a document with filtered sections',
    should: 'keep Accomplishments section',
    actual: filtered.toMarkdown().includes('Accomplishments'),
    expected: true,
  })

  assert({
    given: 'a document with filtered sections',
    should: 'keep Next Steps section',
    actual: filtered.toMarkdown().includes('Next Steps'),
    expected: true,
  })
})

test('Document.filterSections() - handle different heading depths', () => {
  const markdown = `# Main Title

Content under h1.

## Keep Section
Content under h2.

### Nested Content
Content under h3.

## Remove Section
More h2 content.

### Also Remove
This h3 should be removed too.
`

  const doc = Document.fromMarkdown(markdown)
  const filtered = doc.filterSections((heading) => {
    return !heading.text.includes('Remove')
  })

  const result = filtered.toMarkdown()

  assert({
    given: 'a document with mixed heading depths',
    should: 'keep h1',
    actual: result.includes('# Main Title'),
    expected: true,
  })

  assert({
    given: 'a document with mixed heading depths',
    should: 'keep h2 section that passes predicate',
    actual: result.includes('## Keep Section') && result.includes('Content under h2'),
    expected: true,
  })

  assert({
    given: 'a document with h3 under kept h2',
    should: 'keep h3 that belongs to kept h2',
    actual: result.includes('### Nested Content') && result.includes('Content under h3'),
    expected: true,
  })

  assert({
    given: 'a document with h2 that fails predicate',
    should: 'remove h2 section',
    actual: result.includes('## Remove Section'),
    expected: false,
  })

  assert({
    given: 'a document with h3 under removed h2',
    should: 'also remove h3 under removed h2',
    actual: result.includes('### Also Remove'),
    expected: false,
  })
})
