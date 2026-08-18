import { type CollectionEntityType, type CollectionItem, Document } from '#shared/models/Markdown/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { recencyScore } from './recencyScore.ts'

function makeItem(path: string, type: CollectionEntityType): CollectionItem<Document> {
  return { doc: Document.fromMarkdown('---\n---\ncontent'), depth: 0, path, type }
}

/** Round to 2 decimal places for float comparison */
function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// Wednesday inside the 2026/02/23-01 week (Feb 23 – Mar 1)
const TODAY_MS = new PlainDate(2026, 2, 25).toDate().getTime()
const HORIZON = 30

test(`${recencyScore.name} - day docs decay from their day`, () => {
  const FIXTURES = [
    { path: '/Notebook/time/2026/02/23-01/02-25/day.md', expected: 5, given: "today's day file" },
    { path: '/Notebook/time/2026/02/16-22/02-22/day.md', expected: 4.5, given: 'a 3-day-old day file' },
    { path: '/Notebook/time/2026/01/12-18/01-14/day.md', expected: 0, given: 'a day file past the horizon' },
  ]

  for (const fixture of FIXTURES) {
    assert({
      given: fixture.given,
      should: `score ${fixture.expected}`,
      actual: round2(recencyScore(makeItem(fixture.path, 'day'), TODAY_MS, HORIZON)),
      expected: fixture.expected,
    })
  }
})

test(`${recencyScore.name} - span docs age from the end of their span`, () => {
  const FIXTURES = [
    {
      path: '/Notebook/time/2026/02/23-01/week.md',
      expected: 5,
      given: "the current week's plan, mid-week",
    },
    {
      path: '/Notebook/time/2026/02/16-22/week.md',
      expected: 4.5,
      given: 'a week plan whose week ended 3 days ago',
    },
  ]

  for (const fixture of FIXTURES) {
    assert({
      given: fixture.given,
      should: `score ${fixture.expected}`,
      actual: round2(recencyScore(makeItem(fixture.path, 'day'), TODAY_MS, HORIZON)),
      expected: fixture.expected,
    })
  }
})

test(`${recencyScore.name} - undated docs fall back by type`, () => {
  assert({
    given: 'an undated entity doc and an undated non-entity doc',
    should: 'default the entity to mid-range and the rest to zero',
    actual: [
      recencyScore(makeItem('/Notebook/people/Jane-Doe.md', 'person'), TODAY_MS, HORIZON),
      recencyScore(makeItem('/Notebook/reference/Atlas-Glossary.md', 'day'), TODAY_MS, HORIZON),
    ],
    expected: [3, 0],
  })
})
