import StreakDocument from '#shared/models/Streak/mod.ts'
import { assert, test } from '#test'
import PlainDate from '#universal/dates/nbdt/PlainDate/mod.ts'

function makeStreak(yamlLines: string[]): StreakDocument {
  return StreakDocument.fromMarkdown(`---\n${yamlLines.join('\n')}\n---\n\n# Test\n`)
}

// 2026-02-07 is a Saturday, 2026-02-09 a Monday.
const SATURDAY = new PlainDate('2026-02-07')
const MONDAY = new PlainDate('2026-02-09')

test(`StreakDocument.isScheduledOn()`, () => {
  const daily = makeStreak(['name: eat-clean', 'schedule: daily', 'start: 2026-01-05'])
  const weekdays = makeStreak(['name: deep-work', 'schedule: weekdays', 'start: 2026-01-05'])

  assert({
    given: 'a daily streak on a Saturday',
    should: 'be scheduled',
    expected: true,
    actual: daily.isScheduledOn(SATURDAY),
  })
  assert({
    given: 'a weekdays streak on a Saturday',
    should: 'not be scheduled',
    expected: false,
    actual: weekdays.isScheduledOn(SATURDAY),
  })
  assert({
    given: 'a weekdays streak on a Monday',
    should: 'be scheduled',
    expected: true,
    actual: weekdays.isScheduledOn(MONDAY),
  })
})

test(`StreakDocument.isActiveOn()`, () => {
  const s = makeStreak(['name: eat-clean', 'start: 2026-01-05', 'end: 2026-03-01'])

  assert({
    given: 'a day before start',
    should: 'not be active',
    expected: false,
    actual: s.isActiveOn(new PlainDate('2026-01-04')),
  })
  assert({
    given: 'the start day itself',
    should: 'be active',
    expected: true,
    actual: s.isActiveOn(new PlainDate('2026-01-05')),
  })
  assert({
    given: 'the end day itself (inclusive)',
    should: 'be active',
    expected: true,
    actual: s.isActiveOn(new PlainDate('2026-03-01')),
  })
  assert({
    given: 'the day after end',
    should: 'not be active',
    expected: false,
    actual: s.isActiveOn(new PlainDate('2026-03-02')),
  })

  const noStart = makeStreak(['name: broken'])
  assert({
    given: 'a streak with no start date',
    should: 'never be active',
    expected: false,
    actual: noStart.isActiveOn(MONDAY),
  })
})

test(`StreakDocument.isTrackedOn()`, () => {
  const s = makeStreak(['name: deep-work', 'schedule: weekdays', 'start: 2026-01-05'])

  assert({
    given: 'an active scheduled day',
    should: 'be tracked',
    expected: true,
    actual: s.isTrackedOn(MONDAY),
  })
  assert({
    given: 'a weekend under a weekdays schedule',
    should: 'not be tracked',
    expected: false,
    actual: s.isTrackedOn(SATURDAY),
  })
  assert({
    given: 'a day before start',
    should: 'not be tracked',
    expected: false,
    actual: s.isTrackedOn(new PlainDate('2026-01-02')),
  })
})

test(`StreakDocument.formatDayItem()`, () => {
  assert({
    given: 'a title with no count',
    should: 'render the bare title',
    expected: 'Eat clean',
    actual: StreakDocument.formatDayItem('Eat clean'),
  })
  assert({
    given: 'a title with a count',
    should: 'append the run decoration',
    expected: 'Eat clean — 12d',
    actual: StreakDocument.formatDayItem('Eat clean', 12),
  })
})

test(`StreakDocument.parseDayItemTitle()`, () => {
  const given = 'day-list item text in each state'

  assert({
    given,
    should: 'pass a bare title through',
    expected: 'Eat clean',
    actual: StreakDocument.parseDayItemTitle('Eat clean'),
  })
  assert({
    given,
    should: 'strip the count decoration',
    expected: 'Eat clean',
    actual: StreakDocument.parseDayItemTitle('Eat clean — 12d'),
  })
  assert({
    given,
    should: 'strip strikethrough and count',
    expected: 'Eat clean',
    actual: StreakDocument.parseDayItemTitle('~~Eat clean — 12d~~'),
  })
  assert({
    given,
    should: 'strip strikethrough alone',
    expected: 'Eat clean',
    actual: StreakDocument.parseDayItemTitle('~~Eat clean~~'),
  })
  assert({
    given,
    should: 'preserve em-dashes inside the title',
    expected: 'Deep work — no slack',
    actual: StreakDocument.parseDayItemTitle('~~Deep work — no slack — 3d~~'),
  })
})

test(`StreakDocument.matchesDayItem()`, () => {
  const s = makeStreak(['name: eat-clean', 'title: Eat clean', 'start: 2026-01-05'])

  assert({
    given: 'an item using the title, struck and decorated',
    should: 'match',
    expected: true,
    actual: s.matchesDayItem('~~Eat clean — 40d~~'),
  })
  assert({
    given: 'an unrelated item',
    should: 'not match',
    expected: false,
    actual: s.matchesDayItem('Morning run — 5d'),
  })
})

test(`StreakDocument.archive()`, () => {
  const s = makeStreak(['name: eat-clean', 'start: 2026-01-05'])
  const archived = s.archive(new PlainDate('2026-06-30'))

  assert({
    given: 'an archived streak',
    should: 'stamp end',
    expected: '2026-06-30',
    actual: archived.end?.ymd,
  })
  assert({
    given: 'an archived streak',
    should: 'stamp updated',
    expected: true,
    actual: Boolean(archived.yaml['updated']),
  })
  assert({
    given: 'the original streak',
    should: 'be untouched (immutable update)',
    expected: undefined,
    actual: s.end,
  })
})

test(`StreakDocument.archive() honors a planned end`, () => {
  const passed = makeStreak(['name: eat-clean', 'start: 2026-01-05', 'end: 2026-03-01'])
  assert({
    given: 'archiving after a planned end already passed',
    should: 'keep the earlier factual end',
    expected: '2026-03-01',
    actual: passed.archive(new PlainDate('2026-06-30')).end?.ymd,
  })

  const future = makeStreak(['name: eat-clean', 'start: 2026-01-05', 'end: 2026-12-31'])
  assert({
    given: 'archiving early, before the planned end',
    should: 'move the end up to now',
    expected: '2026-06-30',
    actual: future.archive(new PlainDate('2026-06-30')).end?.ymd,
  })
})

test(`StreakDocument.create() with a planned end and details`, () => {
  const s = StreakDocument.create({
    name: 'eat-clean',
    title: 'Eat clean non-processed foods',
    start: new PlainDate('2026-07-27'),
    end: new PlainDate('2026-08-25'),
    why: 'Food quality drives everything else.',
    details: '**The plate**\n\n- Meat\n- Vegetables',
  })

  assert({
    given: 'a planned end at creation',
    should: 'store the inclusive last tracked day',
    expected: '2026-08-25',
    actual: s.end?.ymd,
  })
  assert({
    given: 'a planned end',
    should: 'track through the end day and stop after',
    expected: [true, false],
    actual: [s.isTrackedOn(new PlainDate('2026-08-25')), s.isTrackedOn(new PlainDate('2026-08-26'))],
  })

  const md = s.toMarkdown()
  assert({
    given: 'freeform details',
    should: 'keep them verbatim below the why',
    expected: true,
    actual: md.includes('Food quality drives everything else.\n\n**The plate**\n\n- Meat\n- Vegetables'),
  })
})
