import { assert, test } from '#test'
import DayDocument from '#shared/models/Day/mod.ts'
import StreakDocument, { STREAKS_LIST_TITLE } from '#shared/models/Streak/mod.ts'
import PlainDate from '#universal/dates/nbdt/PlainDate/mod.ts'
import { stampStreaksList, strikeStreakItem } from '#lib/streaks/mod.ts'

function makeStreak(yamlLines: string[]): StreakDocument {
  return StreakDocument.fromMarkdown(`---\n${yamlLines.join('\n')}\n---\n\n# Test\n`)
}

// 2026-03-02 is a Monday, 2026-03-07 a Saturday.
const MONDAY = new PlainDate('2026-03-02')
const SATURDAY = new PlainDate('2026-03-07')

const EAT_CLEAN = makeStreak(['name: eat-clean', 'title: Eat clean', 'start: 2026-01-05'])
const DEEP_WORK = makeStreak(['name: deep-work', 'title: Deep work', 'schedule: weekdays', 'start: 2026-01-05'])

function streaksList(day: DayDocument) {
  return day.lists.find((l) => l.title === STREAKS_LIST_TITLE)
}

test(`stampStreaksList() creates the list between Reminders and Complete`, () => {
  const day = DayDocument.createFutureDay(MONDAY)
  const stamped = stampStreaksList(day, [EAT_CLEAN, DEEP_WORK], MONDAY)

  const titles = stamped.lists.map((l) => l.title)
  const streaksIndex = titles.indexOf(STREAKS_LIST_TITLE)

  assert({
    given: 'a standard future day',
    should: 'insert Streaks after Reminders',
    expected: titles.indexOf('Reminders') + 1,
    actual: streaksIndex,
  })
  assert({
    given: 'a standard future day',
    should: 'insert Streaks before Professional Complete',
    expected: true,
    actual: streaksIndex < titles.indexOf('Professional Complete'),
  })
  assert({
    given: 'two tracked streaks',
    should: 'stamp one bare item each',
    expected: ['Eat clean', 'Deep work'],
    actual: streaksList(stamped)?.items,
  })
})

test(`stampStreaksList() honors schedules`, () => {
  const day = DayDocument.createFutureDay(SATURDAY)
  const stamped = stampStreaksList(day, [EAT_CLEAN, DEEP_WORK], SATURDAY)

  assert({
    given: 'a Saturday with one weekdays streak',
    should: 'stamp only the daily streak',
    expected: ['Eat clean'],
    actual: streaksList(stamped)?.items,
  })
})

test(`stampStreaksList() decorates with counts and refreshes unstruck items`, () => {
  const day = DayDocument.createFutureDay(MONDAY)
  const counts = new Map([['eat-clean', 12]])

  const bare = stampStreaksList(day, [EAT_CLEAN], MONDAY)
  const decorated = stampStreaksList(bare, [EAT_CLEAN], MONDAY, counts)

  assert({
    given: 'a bare item and a fresh count',
    should: 'refresh the decoration in place',
    expected: ['Eat clean — 12d'],
    actual: streaksList(decorated)?.items,
  })

  const rethreshed = stampStreaksList(decorated, [EAT_CLEAN], MONDAY, new Map([['eat-clean', 13]]))
  assert({
    given: 'a stale decoration',
    should: 'update to the new count',
    expected: ['Eat clean — 13d'],
    actual: streaksList(rethreshed)?.items,
  })
})

test(`stampStreaksList() never touches struck items`, () => {
  const day = DayDocument.createFutureDay(MONDAY).addList(STREAKS_LIST_TITLE).addItem(STREAKS_LIST_TITLE, '~~Eat clean — 11d~~')

  const stamped = stampStreaksList(day, [EAT_CLEAN], MONDAY, new Map([['eat-clean', 12]]))

  assert({
    given: 'a struck item with a stale count',
    should: 'preserve the completion record verbatim',
    expected: ['~~Eat clean — 11d~~'],
    actual: streaksList(stamped)?.items,
  })
})

test(`stampStreaksList() preserves hand-added items and appends missing streaks`, () => {
  const day = DayDocument.createFutureDay(MONDAY).addList(STREAKS_LIST_TITLE).addItem(STREAKS_LIST_TITLE, 'Stretch — experimental')

  const stamped = stampStreaksList(day, [EAT_CLEAN], MONDAY)

  assert({
    given: 'an unrecognized hand-added item',
    should: 'keep it and append the tracked streak',
    expected: ['Stretch — experimental', 'Eat clean'],
    actual: streaksList(stamped)?.items,
  })
})

test(`stampStreaksList() is a no-op when already current`, () => {
  const day = stampStreaksList(DayDocument.createFutureDay(MONDAY), [EAT_CLEAN], MONDAY)
  const again = stampStreaksList(day, [EAT_CLEAN], MONDAY)

  assert({
    given: 'an already-stamped day',
    should: 'return the same instance',
    expected: true,
    actual: again === day,
  })
})

test(`stampStreaksList() with nothing tracked leaves the day alone`, () => {
  const day = DayDocument.createFutureDay(MONDAY)
  const stamped = stampStreaksList(day, [], MONDAY)

  assert({
    given: 'no streaks',
    should: 'return the same instance with no Streaks list',
    expected: true,
    actual: stamped === day && streaksList(stamped) === undefined,
  })
})

test(`strikeStreakItem() strikes an unstruck item`, () => {
  const day = stampStreaksList(DayDocument.createFutureDay(MONDAY), [EAT_CLEAN], MONDAY, new Map([['eat-clean', 4]]))
  const result = strikeStreakItem(day, EAT_CLEAN, MONDAY)

  assert({ given: 'an unstruck item', should: 'report struck', expected: 'struck', actual: result.kind })
  assert({
    given: 'the struck day',
    should: 'wrap the item in strikethrough',
    expected: ['~~Eat clean — 4d~~'],
    actual: result.kind === 'struck' ? streaksList(result.day)?.items : undefined,
  })
  assert({
    given: 'the struck item',
    should: 'satisfy the shared done test',
    expected: true,
    actual: result.kind === 'struck' && DayDocument.isItemDone(result.item),
  })
})

test(`strikeStreakItem() stamps first when the item is missing`, () => {
  const day = DayDocument.createFutureDay(MONDAY)
  const result = strikeStreakItem(day, EAT_CLEAN, MONDAY)

  assert({ given: 'a day with no Streaks list', should: 'stamp then strike', expected: 'struck', actual: result.kind })
  assert({
    given: 'the resulting day',
    should: 'hold exactly the struck bare item',
    expected: ['~~Eat clean~~'],
    actual: result.kind === 'struck' ? streaksList(result.day)?.items : undefined,
  })
})

test(`strikeStreakItem() reports an already-struck item`, () => {
  const first = strikeStreakItem(DayDocument.createFutureDay(MONDAY), EAT_CLEAN, MONDAY)
  const again = first.kind === 'struck' ? strikeStreakItem(first.day, EAT_CLEAN, MONDAY) : first

  assert({ given: 'a second strike', should: 'report already', expected: 'already', actual: again.kind })
})

test(`strikeStreakItem() refuses untracked days`, () => {
  const result = strikeStreakItem(DayDocument.createFutureDay(SATURDAY), DEEP_WORK, SATURDAY)

  assert({
    given: 'a weekdays streak on a Saturday',
    should: 'report not-tracked',
    expected: 'not-tracked',
    actual: result.kind,
  })
})
