import { assert, test } from '#test'
import Document from '#shared/models/Markdown/Document/mod.ts'
import type { Link } from '#shared/models/Markdown/Link/mod.ts'

const FIXTURE = `
---
tags: Test; Marketing
---

# **2022-12-30 - Fri**

## Personal Commitments
-

## Personal Complete
-

## Professional Commitments
- 18:00 > Read [super long essay][super_long_essay]
- 19:00 > Visit [crazy_site][]

## Professional Complete
-


[super_long_essay]: https://example.com
[crazy_site]: https://google.com
`.trim()

test(`${Document.name}.referenceLinks()`, () => {
  const given = 'A standard day markdown file with reference links'
  const should = 'Should extract'

  const input = ['- 18:00 > Read [super long essay][super_long_essay]', '- 19:00 > Visit [crazy_site][]'].join('\n')

  const expectedLinks = new Map<string, Link>()
  expectedLinks.set('super_long_essay', { label: 'super_long_essay', href: 'https://example.com' })
  expectedLinks.set('crazy_site', { label: 'crazy_site', href: 'https://google.com' })

  const doc = Document.fromMarkdown(FIXTURE)

  const expected = JSON.stringify(Array.from(expectedLinks.entries()), null, 2)
  const actualLinks = doc.referenceLinks(input)
  const actual = JSON.stringify(Array.from(actualLinks.entries()), null, 2)

  assert({
    given,
    should,
    expected,
    actual,
  })
})
