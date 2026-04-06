import { assert, test } from '#test'
import { Document } from '#shared/models/Markdown/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { getDocumentDate, matchesDate, matchesDateRange, matchesRecent } from './date.ts'

function md(yaml: string, body = ''): Document {
  return Document.fromMarkdown(`---\n${yaml}\n---\n${body}`)
}

// =============================================================================
// getDocumentDate
// =============================================================================

const documentDateFixtures = [
  { yaml: 'date: 2025-01-15', expected: '2025-01-15', description: 'date field as string' },
  { yaml: 'created: 2025-01-20', expected: '2025-01-20', description: 'created field' },
  { yaml: 'identified: 2025-01-25', expected: '2025-01-25', description: 'identified field (decisions)' },
  { yaml: 'title: No Date', expected: undefined, description: 'no date fields' },
]

for (const { yaml, expected, description } of documentDateFixtures) {
  test(`getDocumentDate - ${description}`, () => {
    const doc = md(yaml)
    const result = getDocumentDate(doc)

    assert({
      given: description,
      should: expected ? `return ${expected}` : 'return undefined',
      actual: result?.toString(),
      expected,
    })
  })
}

test('getDocumentDate - path date takes priority over created', () => {
  const doc = md('created: 2026-02-18')
  const path = '/Notebook/time/2026/02/02-08/05/actions/messages/some-message.md'
  const result = getDocumentDate(doc, path)

  assert({
    given: 'doc with created: 2026-02-18 but path date is 2026-02-05',
    should: 'return path date (event date), not created date',
    actual: result?.toString(),
    expected: '2026-02-05',
  })
})

test('getDocumentDate - date YAML field still takes priority over path', () => {
  const doc = md('date: 2026-02-15')
  const path = '/Notebook/time/2026/02/09-15/13/actions/meetings/some-meeting.md'
  const result = getDocumentDate(doc, path)

  assert({
    given: 'doc with date: 2026-02-15 and path date 2026-02-13',
    should: 'return YAML date field (explicit event date)',
    actual: result?.toString(),
    expected: '2026-02-15',
  })
})

// =============================================================================
// matchesRecent
// =============================================================================

const recentFixtures = [
  {
    yaml: 'date: 2025-01-25',
    duration: '7d',
    now: '2025-01-30',
    expected: true,
    description: 'document within period',
  },
  {
    yaml: 'date: 2025-01-10',
    duration: '7d',
    now: '2025-01-30',
    expected: false,
    description: 'document outside period',
  },
  {
    yaml: 'title: No Date',
    duration: '7d',
    now: '2025-01-30',
    expected: false,
    description: 'document without date',
  },
  {
    yaml: 'date: 2025-02-05',
    duration: '7d',
    now: '2025-01-30',
    expected: false,
    description: 'future document excluded',
  },
  {
    yaml: 'date: 2025-01-30',
    duration: '7d',
    now: '2025-01-30',
    expected: true,
    description: 'document on today matches',
  },
]

for (const { yaml, duration, now, expected, description } of recentFixtures) {
  test(`matchesRecent - ${description}`, () => {
    const doc = md(yaml)
    assert({
      given: description,
      should: expected ? 'match' : 'not match',
      actual: matchesRecent(doc, duration, PlainDate.from(now)),
      expected,
    })
  })
}

// =============================================================================
// matchesDate
// =============================================================================

const dateFixtures = [
  { yaml: 'date: 2025-01-15', target: '2025-01-15', expected: true, description: 'exact match' },
  { yaml: 'date: 2025-01-15', target: '2025-01-20', expected: false, description: 'no match' },
]

for (const { yaml, target, expected, description } of dateFixtures) {
  test(`matchesDate - ${description}`, () => {
    const doc = md(yaml)
    assert({
      given: description,
      should: expected ? 'match' : 'not match',
      actual: matchesDate(doc, target),
      expected,
    })
  })
}

// =============================================================================
// matchesDateRange
// =============================================================================

const dateRangeFixtures = [
  {
    yaml: 'date: 2025-01-15',
    start: '2025-01-01',
    end: '2025-01-31',
    expected: true,
    description: 'within range',
  },
  {
    yaml: 'date: 2025-02-15',
    start: '2025-01-01',
    end: '2025-01-31',
    expected: false,
    description: 'outside range',
  },
]

for (const { yaml, start, end, expected, description } of dateRangeFixtures) {
  test(`matchesDateRange - ${description}`, () => {
    const doc = md(yaml)
    assert({
      given: description,
      should: expected ? 'match' : 'not match',
      actual: matchesDateRange(doc, start, end),
      expected,
    })
  })
}
