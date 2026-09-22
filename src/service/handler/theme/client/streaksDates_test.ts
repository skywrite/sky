import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import type { StreakView } from '../../streaks/types.ts'
import {
  shiftStreakMonth,
  streakDayState,
  streakMonth,
  streakMonthDays,
  streakPeriod,
  streakPeriodSummary,
  streakTracked,
} from './streaksDates.ts'

function habit(values: Partial<StreakView> = {}): StreakView {
  return {
    name: 'read-a-chapter',
    title: 'Read a chapter',
    category: null,
    schedule: 'daily',
    start: '2028-02-01',
    end: null,
    status: 'active',
    relativePath: 'streaks/active/read-a-chapter.md',
    revision: 'fixture',
    why: '',
    rule: '',
    bodyHtml: '',
    done: [],
    current: 0,
    best: 0,
    ...values,
  }
}

test('streak calendars respect leap years and preserve the selected month when zooming', () => {
  const quarter = streakPeriod('2028-02', 'quarter')
  const year = streakPeriod(quarter.anchor, 'year')
  assert({
    given: 'February in a leap year',
    should: 'include February 29',
    actual: streakMonthDays('2028-02').at(-1)?.ymd,
    expected: '2028-02-29',
  })
  assert({
    given: 'February in a common year',
    should: 'stop at February 28',
    actual: streakMonthDays('2027-02').at(-1)?.ymd,
    expected: '2027-02-28',
  })
  assert({
    given: 'quarterly history',
    should: 'include exactly the three calendar months',
    actual: quarter.months,
    expected: ['2028-01', '2028-02', '2028-03'],
  })
  assert({
    given: 'a leap-year history',
    should: 'include every date once',
    actual: [year.days.length, new Set(year.days.map((day) => day.ymd)).size],
    expected: [366, 366],
  })
  assert({
    given: 'month to quarter to year to month',
    should: 'retain the original February anchor',
    actual: streakPeriod(year.anchor, 'month').label,
    expected: 'February 2028',
  })
  assert({
    given: 'the last quarter of a year',
    should: 'navigate into the first quarter of the next year',
    actual: streakPeriod(shiftStreakMonth('2028-10', 3), 'quarter').label,
    expected: 'Q1 · 2029',
  })
  assert({
    given: 'a year view beyond the prototype data range',
    should: 'use the requested calendar year',
    actual: streakPeriod('2035-09', 'year').months.at(-1),
    expected: '2035-12',
  })
})

test('streak period rates count only elapsed scheduled days, including completed today', () => {
  const streak = habit({ schedule: 'weekdays', start: '2028-02-25', end: '2028-02-29', done: ['2028-02-25'] })
  const dates = streakMonthDays('2028-02')
  assert({
    given: 'Friday complete, weekend off, Monday pending',
    should: 'exclude the weekend and pending today from the denominator',
    actual: streakPeriodSummary(streak, dates, '2028-02-28'),
    expected: { done: 1, total: 1, percent: 100 },
  })
  assert({
    given: 'Monday completed too',
    should: 'include today in both counts',
    actual: streakPeriodSummary({ ...streak, done: [...streak.done, '2028-02-28'] }, dates, '2028-02-28'),
    expected: { done: 2, total: 2, percent: 100 },
  })
  assert({
    given: 'Monday not recorded by Tuesday',
    should: 'count Monday as an elapsed miss',
    actual: streakPeriodSummary(streak, dates, '2028-02-29'),
    expected: { done: 1, total: 2, percent: 50 },
  })
  assert({
    given: 'inclusive start and end dates',
    should: 'track both bounds but not dates outside them or weekends',
    actual: ['2028-02-24', '2028-02-25', '2028-02-26', '2028-02-29', '2028-03-01'].map((date) =>
      streakTracked(streak, new PlainDate(date)),
    ),
    expected: [false, true, false, true, false],
  })
  assert({
    given: 'a streak with no start',
    should: 'remain unscheduled',
    actual: streakTracked(habit({ start: null }), new PlainDate('2028-02-28')),
    expected: false,
  })
})

test('streak day states distinguish pending, missing, future and unscheduled dates', () => {
  const streak = habit({ start: '2028-02-25', done: ['2028-02-25'] })
  assert({
    given: 'dates around a pending today',
    should: 'display their record states without treating today as missed',
    actual: ['2028-02-24', '2028-02-25', '2028-02-26', '2028-02-28', '2028-02-29'].map((date) =>
      streakDayState(streak, new PlainDate(date), '2028-02-28'),
    ),
    expected: ['off', 'done', 'missed', 'pending', 'future'],
  })
  assert({
    given: 'an invalid query month',
    should: 'fall back to the notebook month',
    actual: streakMonth('2028-13', '2028-02-28'),
    expected: '2028-02',
  })
})
