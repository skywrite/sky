import { assert, test } from '#test'
import * as marked from 'marked'

// Test to ensure marked token types and structure remain compatible after upgrade
test('marked token compatibility', () => {
  const testMarkdown = `# Heading 1

## Heading 2

- List item 1
- List item 2
  - Nested item

[link text](https://example.com)

[reference-link]

[reference-link]: https://example.com/reference "Reference Title"
`

  const tokens = marked.lexer(testMarkdown, {})

  // Test that tokens is an array
  assert({
    given: 'markdown with various elements',
    should: 'produce a tokens array',
    actual: Array.isArray(tokens),
    expected: true,
  })

  // Test that links object exists
  assert({
    given: 'markdown with reference links',
    should: 'have links property',
    actual: 'links' in tokens,
    expected: true,
  })

  // Test heading token structure
  const headingToken = tokens.find((t) => t.type === 'heading' && t.depth === 1)
  assert({
    given: 'heading token',
    should: 'have expected properties',
    actual: headingToken && 'text' in headingToken && 'raw' in headingToken,
    expected: true,
  })

  // Test list token structure
  const listToken = tokens.find((t) => t.type === 'list') as marked.Tokens.List
  assert({
    given: 'list token',
    should: 'have items array',
    actual: listToken && Array.isArray(listToken.items),
    expected: true,
  })

  // Test list item structure
  if (listToken && listToken.items.length > 0) {
    const listItem = listToken.items[0]
    assert({
      given: 'list item',
      should: 'have text property',
      actual: 'text' in listItem,
      expected: true,
    })
  }

  // Test that lexer doesn't throw on complex markdown
  const complexMarkdown = `---
created: 2025-07-31
---

# Complex Document

## Lists
- Item with **bold** and *italic*
- Item with \`code\`
- Item with [link](https://example.com)

## Code Block
\`\`\`typescript
const test = "hello";
\`\`\`

## Table
| Header 1 | Header 2 |
|----------|----------|
| Cell 1   | Cell 2   |
`

  let complexTokens
  try {
    complexTokens = marked.lexer(complexMarkdown, {})
    assert({
      given: 'complex markdown',
      should: 'parse without errors',
      actual: true,
      expected: true,
    })
  } catch (e) {
    assert({
      given: 'complex markdown',
      should: 'parse without errors',
      actual: false,
      expected: true,
    })
  }
})
