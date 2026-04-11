import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import nbfsWeekMonth from './nbfsWeekMonth.ts'

test('nbfsWeekMonth - normal mid-month weeks', () => {
  const fixtures = [
    { date: '2026-02-15', expected: 2, description: 'mid-Feb, Thu Feb 12' },
    { date: '2026-06-10', expected: 6, description: 'mid-Jun, Thu Jun 11' },
    { date: '2026-11-20', expected: 11, description: 'mid-Nov, Thu Nov 19' },
  ]

  for (const { date, expected, description } of fixtures) {
    assert({
      given: `${date} (${description})`,
      should: `return month ${expected}`,
      actual: nbfsWeekMonth(date),
      expected,
    })
  }
})

test('nbfsWeekMonth - cross-month weeks use month of Thursday', () => {
  const fixtures = [
    // W05-2026: Mon Jan 26 - Sun Feb 1, Thu = Jan 29 → January
    { date: '2026-01-26', expected: 1, description: 'Mon of cross-month week, Thu in Jan' },
    { date: '2026-02-01', expected: 1, description: 'Sun of cross-month week, Thu in Jan' },

    // W09-2026: Mon Feb 23 - Sun Mar 1, Thu = Feb 26 → February
    { date: '2026-03-01', expected: 2, description: 'Sun of cross-month week, Thu in Feb' },

    // W40-2026: Mon Sep 28 - Sun Oct 4, Thu = Oct 1 → October
    { date: '2026-09-28', expected: 10, description: 'Mon of cross-month week, Thu in Oct' },
    { date: '2026-10-01', expected: 10, description: 'Thu of cross-month week, Thu in Oct' },
  ]

  for (const { date, expected, description } of fixtures) {
    assert({
      given: `${date} (${description})`,
      should: `return month ${expected}`,
      actual: nbfsWeekMonth(date),
      expected,
    })
  }
})

test('nbfsWeekMonth - W00 always returns January', () => {
  const fixtures = [
    { date: '2027-01-01', description: 'Jan 1 = Friday' },
    { date: '2022-01-01', description: 'Jan 1 = Saturday' },
    { date: '2023-01-01', description: 'Jan 1 = Sunday' },
  ]

  for (const { date, description } of fixtures) {
    assert({
      given: `${date} (${description}, W00)`,
      should: 'return 1 (January)',
      actual: nbfsWeekMonth(date),
      expected: 1,
    })
  }
})

test('nbfsWeekMonth - W53 always returns December', () => {
  const fixtures = [
    { date: '2025-12-29', description: 'non-ISO W53 overflow' },
    { date: '2025-12-31', description: 'non-ISO W53 overflow' },
    { date: '2026-12-28', description: 'genuine ISO W53' },
    { date: '2026-12-31', description: 'genuine ISO W53' },
  ]

  for (const { date, description } of fixtures) {
    assert({
      given: `${date} (${description})`,
      should: 'return 12 (December)',
      actual: nbfsWeekMonth(date),
      expected: 12,
    })
  }
})

test('nbfsWeekMonth - accepts PlainDate', () => {
  const date = new PlainDate(2026, 2, 15)
  assert({
    given: 'a PlainDate instance',
    should: 'return the correct month',
    actual: nbfsWeekMonth(date),
    expected: 2,
  })
})
