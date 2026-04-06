import { assert, test } from '#test'
import { buildEditableBlocks, buildMarkdownDocumentEditorState } from './documentState.ts'

test('markdown document state separates frontmatter from editable blocks', async () => {
  const source = `---
title: Synthetic Preview
tags:
  - test
---

# Heading

Paragraph text.
`

  const state = await buildMarkdownDocumentEditorState(source, 42)

  assert({
    given: 'a markdown file with frontmatter and body blocks',
    should: 'preserve the full content',
    actual: state.content,
    expected: source,
  })

  assert({
    given: 'a markdown file with frontmatter and body blocks',
    should: 'preserve the provided version',
    actual: state.version,
    expected: 42,
  })

  assert({
    given: 'a markdown file with frontmatter and body blocks',
    should: 'surface frontmatter separately',
    actual: state.frontmatter,
    expected: 'title: Synthetic Preview\ntags:\n  - test',
  })

  assert({
    given: 'a markdown file with frontmatter and body blocks',
    should: 'exclude frontmatter from editable block descriptors',
    actual: state.blocks.some((block) => block.type === 'frontmatter'),
    expected: false,
  })

  assert({
    given: 'a markdown file with frontmatter and body blocks',
    should: 'start editable blocks with the rendered heading block',
    actual: state.blocks[0]?.type,
    expected: 'heading',
  })
})

test('editable block descriptors preserve source offsets after frontmatter', async () => {
  const source = `---
title: Synthetic Preview
---

# Heading

Paragraph text.

- First
- Second
`

  const blocks = await buildEditableBlocks(source)
  const heading = blocks[0]
  const paragraph = blocks[1]
  const list = blocks[2]

  assert({
    given: 'editable block descriptors for a markdown file with frontmatter',
    should: 'point the heading offsets at the exact heading source',
    actual: source.slice(heading.startOffset, heading.endOffset),
    expected: heading.raw,
  })

  assert({
    given: 'editable block descriptors for a markdown file with frontmatter',
    should: 'point the paragraph offsets at the exact paragraph source',
    actual: source.slice(paragraph.startOffset, paragraph.endOffset),
    expected: paragraph.raw,
  })

  assert({
    given: 'editable block descriptors for a markdown file with frontmatter',
    should: 'point the list offsets at the exact list source',
    actual: source.slice(list.startOffset, list.endOffset),
    expected: list.raw,
  })

  assert({
    given: 'editable block descriptors for a markdown file with frontmatter',
    should: 'keep offsets ordered through the document',
    actual: heading.endOffset <= paragraph.startOffset && paragraph.endOffset <= list.startOffset,
    expected: true,
  })
})
