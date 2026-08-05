import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import createDayLabeler from './dayLabel.ts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE = '/Users/test/Notebook'

/** Build a day-tree path the way the notebook lays them out. */
function dayPath(year: number, month: string, week: string, day: string, file = 'day.md'): string {
  return `${BASE}/time/${year}/${month}/${week}/${day}/${file}`
}

const TODAY = new PlainDate(2026, 5, 14)

// ---------------------------------------------------------------------------
// Relative labels inside the week window
// ---------------------------------------------------------------------------

test(createDayLabeler.name, () => {
  const label = createDayLabeler(TODAY)

  const FIXTURES: Array<{ path: string; expected: string; given: string }> = [
    { path: dayPath(2026, '05', '11-17', '05-14'), expected: '2026-05-14 Thu (TODAY)', given: "today's day file" },
    { path: dayPath(2026, '05', '11-17', '05-13'), expected: '2026-05-13 Wed (yesterday)', given: "yesterday's" },
    { path: dayPath(2026, '05', '11-17', '05-12'), expected: '2026-05-12 Tue (2 days ago)', given: 'two days back' },
    { path: dayPath(2026, '05', '04-10', '05-09'), expected: '2026-05-09 Sat (5 days ago)', given: 'five days back' },
    { path: dayPath(2026, '05', '04-10', '05-08'), expected: '2026-05-08 Fri (6 days ago)', given: 'six days back' },
  ]

  for (const fixture of FIXTURES) {
    assert({
      given: fixture.given,
      should: `label it "${fixture.expected}"`,
      actual: label(fixture.path),
      expected: fixture.expected,
    })
  }
})

// ---------------------------------------------------------------------------
// Beyond the week window — bare stamp, no relative suffix
// ---------------------------------------------------------------------------

test('createDayLabeler — drops the relative suffix once a week out', () => {
  const label = createDayLabeler(TODAY)

  const FIXTURES: Array<{ path: string; expected: string; given: string }> = [
    { path: dayPath(2026, '05', '04-10', '05-07'), expected: '2026-05-07 Thu', given: 'exactly seven days back' },
    { path: dayPath(2024, '06', '03-09', '06-03'), expected: '2024-06-03 Mon', given: 'a day from a prior year' },
  ]

  for (const fixture of FIXTURES) {
    assert({
      given: fixture.given,
      should: `label it "${fixture.expected}"`,
      actual: label(fixture.path),
      expected: fixture.expected,
    })
  }
})

// ---------------------------------------------------------------------------
// Days ahead of today
// ---------------------------------------------------------------------------

test('createDayLabeler — marks days ahead rather than reporting negatives', () => {
  const label = createDayLabeler(TODAY)

  assert({
    given: 'a day after today',
    should: 'label it as future',
    actual: label(dayPath(2026, '05', '11-17', '05-15')),
    expected: '2026-05-15 Fri (future)',
  })
})

// ---------------------------------------------------------------------------
// Undated documents — no day dir to parse
// ---------------------------------------------------------------------------

test('createDayLabeler — leaves undated documents unlabeled', () => {
  const label = createDayLabeler(TODAY)

  // Dating these from `created:` would be a lie: there it means file edit time.
  const UNDATED = [`${BASE}/people/2022/ja/Jane-Doe.md`, `${BASE}/goals/atlas.md`, `${BASE}/orgs/example/Atlas.md`]

  for (const path of UNDATED) {
    assert({
      given: `an undated document at ${path.slice(BASE.length + 1)}`,
      should: 'return no label',
      actual: label(path),
      expected: undefined,
    })
  }
})

// ---------------------------------------------------------------------------
// Non-day files within a day dir — the ones that actually get misdated
// ---------------------------------------------------------------------------

test('createDayLabeler — labels documents nested under a day dir', () => {
  const label = createDayLabeler(TODAY)

  assert({
    given: "a meeting nested under today's day dir",
    should: 'label it as today',
    actual: label(dayPath(2026, '05', '11-17', '05-14', 'actions/meetings/Zoom_Jane-Doe_Atlas-Review.md')),
    expected: '2026-05-14 Thu (TODAY)',
  })
})

// ---------------------------------------------------------------------------
// DST boundary — the day count must stay whole
// ---------------------------------------------------------------------------

test('createDayLabeler — counts whole days across a DST boundary', () => {
  // US DST ends 2026-11-01, making that local day 25 hours long. Flooring the
  // elapsed milliseconds would report Oct 31 as 2 days before Nov 2.
  const label = createDayLabeler(new PlainDate(2026, 11, 2))

  const FIXTURES: Array<{ path: string; expected: string; given: string }> = [
    {
      path: dayPath(2026, '11', '02-08', '11-02'),
      expected: '2026-11-02 Mon (TODAY)',
      given: 'the day after the shift',
    },
    { path: dayPath(2026, '10', '26-01', '11-01'), expected: '2026-11-01 Sun (yesterday)', given: 'the 25-hour day' },
    {
      path: dayPath(2026, '10', '26-01', '10-31'),
      expected: '2026-10-31 Sat (2 days ago)',
      given: 'the day before it',
    },
  ]

  for (const fixture of FIXTURES) {
    assert({
      given: fixture.given,
      should: `label it "${fixture.expected}"`,
      actual: label(fixture.path),
      expected: fixture.expected,
    })
  }
})

// ---------------------------------------------------------------------------
// Cross-month week dirs — month comes from the day dir, not the week dir
// ---------------------------------------------------------------------------

test('createDayLabeler — resolves cross-month days from the day dir', () => {
  const label = createDayLabeler(new PlainDate(2026, 4, 2))

  const FIXTURES: Array<{ path: string; expected: string; given: string }> = [
    { path: dayPath(2026, '03', '28-03', '04-02'), expected: '2026-04-02 Thu (TODAY)', given: 'the April side' },
    { path: dayPath(2026, '03', '28-03', '03-31'), expected: '2026-03-31 Tue (2 days ago)', given: 'the March side' },
  ]

  for (const fixture of FIXTURES) {
    assert({
      given: `a week dir spanning March into April, ${fixture.given}`,
      should: `label it "${fixture.expected}"`,
      actual: label(fixture.path),
      expected: fixture.expected,
    })
  }
})
