import StreakDocument, { computeStreakStats, type StreakDayEntry } from '#shared/models/Streak/mod.ts'
import { assert, test } from '#test'
import PlainDate from '#universal/dates/nbdt/PlainDate/mod.ts'

function makeStreak(yamlLines: string[]): StreakDocument {
  return StreakDocument.fromMarkdown(`---\n${yamlLines.join('\n')}\n---\n\n# Test\n`)
}

function entry(ymd: string, ...items: string[]): StreakDayEntry {
  return { day: new PlainDate(ymd), items }
}

// 2026-03-02 is a Monday; 2026-03-06 a Friday; 2026-03-09 the next Monday.
const DAILY = ['name: eat-clean', 'title: Eat clean', 'schedule: daily', 'start: 2026-03-02']

test(`computeStreakStats() basic run`, () => {
  const streak = makeStreak(DAILY)
  const entries = [
    entry('2026-03-02', '~~Eat clean~~'),
    entry('2026-03-03', '~~Eat clean — 1d~~'),
    entry('2026-03-04', '~~Eat clean — 2d~~'),
  ]
  const stats = computeStreakStats(streak, entries, new PlainDate('2026-03-05'))

  assert({
    given: 'three struck days, today pending',
    should: 'count the run',
    expected: 3,
    actual: stats.current,
  })
  assert({ given: 'the same walk', should: 'track best', expected: 3, actual: stats.best })
  assert({
    given: 'an unstruck today',
    should: 'stay pending, not missed',
    expected: false,
    actual: stats.completedToday,
  })
  assert({ given: 'a tracked today', should: 'report trackedToday', expected: true, actual: stats.trackedToday })
  assert({
    given: 'the month window',
    should: 'exclude pending today from denominator',
    expected: 3,
    actual: stats.monthTracked,
  })
  assert({ given: 'the month window', should: 'count three dones', expected: 3, actual: stats.monthDone })
  assert({ given: 'the walk', should: 'remember last done day', expected: '2026-03-04', actual: stats.lastDone?.ymd })
})

test(`computeStreakStats() today struck extends the run`, () => {
  const streak = makeStreak(DAILY)
  const entries = [
    entry('2026-03-02', '~~Eat clean~~'),
    entry('2026-03-03', '~~Eat clean~~'),
    entry('2026-03-04', '~~Eat clean~~'),
  ]
  const stats = computeStreakStats(streak, entries, new PlainDate('2026-03-04'))

  assert({ given: 'today struck', should: 'extend the run', expected: 3, actual: stats.current })
  assert({ given: 'today struck', should: 'report completedToday', expected: true, actual: stats.completedToday })
  assert({ given: 'today struck', should: 'enter the month denominator', expected: 3, actual: stats.monthTracked })
})

test(`computeStreakStats() a miss resets the run`, () => {
  const streak = makeStreak(DAILY)
  const entries = [
    entry('2026-03-02', '~~Eat clean~~'),
    entry('2026-03-03', '~~Eat clean~~'),
    entry('2026-03-04', 'Eat clean — 2d'), // present but unstruck = miss
    entry('2026-03-05', '~~Eat clean~~'),
  ]
  const stats = computeStreakStats(streak, entries, new PlainDate('2026-03-05'))

  assert({
    given: 'done, done, miss, done',
    should: 'reset the run at the miss',
    expected: 1,
    actual: stats.current,
  })
  assert({ given: 'the earlier two-day run', should: 'remain the best', expected: 2, actual: stats.best })
})

test(`computeStreakStats() missing day files count as misses`, () => {
  const streak = makeStreak(DAILY)
  const entries = [entry('2026-03-02', '~~Eat clean~~')] // 03-03 has no entry at all
  const stats = computeStreakStats(streak, entries, new PlainDate('2026-03-04'))

  assert({
    given: 'an absent day between done days',
    should: 'break the run',
    expected: 0,
    actual: stats.current,
  })
  assert({ given: 'the first day', should: 'still be the best run', expected: 1, actual: stats.best })
})

test(`computeStreakStats() weekends are transparent under a weekdays schedule`, () => {
  const streak = makeStreak(['name: deep-work', 'title: Deep work', 'schedule: weekdays', 'start: 2026-03-02'])
  const entries = [
    entry('2026-03-05', '~~Deep work~~'), // Thu
    entry('2026-03-06', '~~Deep work~~'), // Fri
    // Sat 03-07 and Sun 03-08: not scheduled, no entries
    entry('2026-03-09', '~~Deep work~~'), // Mon
  ]
  const stats = computeStreakStats(streak, entries, new PlainDate('2026-03-09'))

  assert({
    given: 'Thu+Fri done, weekend skipped, Mon done',
    should: 'treat the weekend as transparent',
    expected: 3,
    actual: stats.current,
  })
})

test(`computeStreakStats() ended streaks freeze at their end`, () => {
  const streak = makeStreak([...DAILY, 'end: 2026-03-04'])
  const entries = [
    entry('2026-03-02', '~~Eat clean~~'),
    entry('2026-03-03', '~~Eat clean~~'),
    entry('2026-03-04', '~~Eat clean~~'),
  ]
  const stats = computeStreakStats(streak, entries, new PlainDate('2026-03-10'))

  assert({
    given: 'a streak that ended 03-04 with all days struck',
    should: 'freeze the run as of the end',
    expected: 3,
    actual: stats.current,
  })
  assert({ given: 'a day after end', should: 'not be tracked today', expected: false, actual: stats.trackedToday })
})

test(`computeStreakStats() attributes items via title and decoration`, () => {
  const streak = makeStreak(DAILY)
  const entries = [entry('2026-03-02', '~~Eat clean — 7d~~', 'Morning run'), entry('2026-03-03', '~~Eat clean~~')]
  const stats = computeStreakStats(streak, entries, new PlainDate('2026-03-03'))

  assert({
    given: 'decorated and bare struck items among others',
    should: 'attribute both to the streak',
    expected: 2,
    actual: stats.current,
  })
})

test(`computeStreakStats() future start yields zeroes`, () => {
  const streak = makeStreak(DAILY)
  const stats = computeStreakStats(streak, [], new PlainDate('2026-02-01'))

  assert({ given: 'a streak that has not started', should: 'have no run', expected: 0, actual: stats.current })
  assert({
    given: 'a streak that has not started',
    should: 'not be tracked today',
    expected: false,
    actual: stats.trackedToday,
  })
})
