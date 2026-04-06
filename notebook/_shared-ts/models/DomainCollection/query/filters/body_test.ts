import { assert, test } from '#test'
import { Document } from '#shared/models/Markdown/mod.ts'
import { matchesBodyContains, matchesBodyMatches } from './body.ts'

function md(yaml: string, body = ''): Document {
  return Document.fromMarkdown(`---\n${yaml}\n---\n${body}`)
}

// =============================================================================
// matchesBodyContains
// =============================================================================

const containsFixtures = [
  {
    body: '# Notes\n\nDiscussed partnership opportunities.',
    text: 'partnership',
    expected: true,
    description: 'text in body',
  },
  { body: '# Notes\n\nDiscussed budget.', text: 'partnership', expected: false, description: 'text not in body' },
  {
    body: '# Notes\n\nDiscussed PARTNERSHIP.',
    text: 'partnership',
    expected: true,
    description: 'case insensitive',
  },
]

for (const { body, text, expected, description } of containsFixtures) {
  test(`matchesBodyContains - ${description}`, () => {
    const doc = md('title: Meeting', body)
    assert({
      given: description,
      should: expected ? 'match' : 'not match',
      actual: matchesBodyContains(doc, text),
      expected,
    })
  })
}

test('matchesBodyContains - handles null text parameter', () => {
  const doc = md('title: Meeting', 'Some content')
  assert({
    given: 'null text parameter',
    should: 'return false without throwing',
    actual: matchesBodyContains(doc, null as unknown as string),
    expected: false,
  })
})

// =============================================================================
// matchesBodyMatches
// =============================================================================

const matchesFixtures = [
  {
    body: '# Notes\n\nQuarterly performance review.',
    pattern: 'quarterly.*review',
    expected: true,
    description: 'regex match',
  },
  { body: '# Notes\n\nMonthly update.', pattern: 'quarterly.*review', expected: false, description: 'regex no match' },
]

for (const { body, pattern, expected, description } of matchesFixtures) {
  test(`matchesBodyMatches - ${description}`, () => {
    const doc = md('title: Meeting', body)
    assert({
      given: description,
      should: expected ? 'match' : 'not match',
      actual: matchesBodyMatches(doc, pattern),
      expected,
    })
  })
}

test('matchesBodyMatches - handles null pattern parameter', () => {
  const doc = md('title: Meeting', 'Some content')
  assert({
    given: 'null pattern parameter',
    should: 'return false without throwing',
    actual: matchesBodyMatches(doc, null as unknown as string),
    expected: false,
  })
})
