import Document from '#shared/models/Markdown/Document/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'

test('Document - created returns PlainDate when date string exists', () => {
  const markdown = `---
title: Created Test
created: 2025-10-11
---

# Test`

  const doc = Document.fromMarkdown(markdown)

  assert({
    given: 'a document with created date',
    should: 'return a PlainDate instance',
    actual: doc.created instanceof PlainDate,
    expected: true,
  })
  assert({ actual: doc.created?.ymd, expected: '2025-10-11' })
})

test('Document - created returns undefined when not set', () => {
  const markdown = `---
title: No Created Date
---

# Test`

  const doc = Document.fromMarkdown(markdown)

  assert({ actual: doc.created, expected: undefined })
})

test('Document - updated returns PlainDate when date string exists', () => {
  const markdown = `---
title: Updated Test
updated: 2025-10-11
---

# Test`

  const doc = Document.fromMarkdown(markdown)

  assert({
    given: 'a document with updated date',
    should: 'return a PlainDate instance',
    actual: doc.updated instanceof PlainDate,
    expected: true,
  })
  assert({ actual: doc.updated?.ymd, expected: '2025-10-11' })
})

test('Document - updated returns undefined when not set', () => {
  const markdown = `---
title: No Updated Date
---

# Test`

  const doc = Document.fromMarkdown(markdown)

  assert({ actual: doc.updated, expected: undefined })
})

test('Document - created and updated work together', () => {
  const markdown = `---
title: Both Dates
created: 2025-10-10
updated: 2025-10-11
---

# Test`

  const doc = Document.fromMarkdown(markdown)

  assert({ actual: doc.created instanceof PlainDate, expected: true })
  assert({ actual: doc.updated instanceof PlainDate, expected: true })
  assert({ actual: doc.created?.ymd, expected: '2025-10-10' })
  assert({ actual: doc.updated?.ymd, expected: '2025-10-11' })
})

test('Document.ensureCreatedUpdated - sets both dates when neither exists', () => {
  const markdown = `---
title: Test
---

# Test`

  const doc = Document.fromMarkdown(markdown)
  const updated = doc.ensureCreatedUpdated()
  const today = PlainDate.today().ymd

  assert({ actual: updated.created?.ymd, expected: today })
  assert({ actual: updated.updated?.ymd, expected: today })
})

test('Document.ensureCreatedUpdated - preserves created but updates updated', () => {
  const markdown = `---
title: Test
created: 2025-10-10
---

# Test`

  const doc = Document.fromMarkdown(markdown)
  const updated = doc.ensureCreatedUpdated()
  const today = PlainDate.today().ymd

  assert({ actual: updated.created?.ymd, expected: '2025-10-10' })
  assert({ actual: updated.updated?.ymd, expected: today })
})

test('Document.ensureCreatedUpdated - always updates updated field', () => {
  const markdown = `---
title: Test
created: 2025-10-10
updated: 2025-10-11
---

# Test`

  const doc = Document.fromMarkdown(markdown)
  const updated = doc.ensureCreatedUpdated()
  const today = PlainDate.today().ymd

  assert({ actual: updated.created?.ymd, expected: '2025-10-10' })
  assert({ actual: updated.updated?.ymd, expected: today })
})

test('Document.ensureCreatedUpdated - stamps a provided date instead of today', () => {
  const markdown = `---
title: Test
---

# Test`

  const doc = Document.fromMarkdown(markdown)
  const updated = doc.ensureCreatedUpdated('2026-03-05')

  assert({ actual: updated.created?.ymd, expected: '2026-03-05' })
  assert({ actual: updated.updated?.ymd, expected: '2026-03-05' })
})

test('Document.ensureCreatedUpdated - provided date never rewrites existing created', () => {
  const markdown = `---
title: Test
created: 2025-10-10
---

# Test`

  const doc = Document.fromMarkdown(markdown)
  const updated = doc.ensureCreatedUpdated('2026-03-05')

  assert({ actual: updated.created?.ymd, expected: '2025-10-10' })
  assert({ actual: updated.updated?.ymd, expected: '2026-03-05' })
})
