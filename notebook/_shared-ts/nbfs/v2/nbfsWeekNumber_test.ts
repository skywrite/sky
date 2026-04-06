import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import nbfsWeekNumber from './nbfsWeekNumber.ts'

test('nbfsWeekNumber - normal mid-year', () => {
  const fixtures = [
    { date: '2026-02-15', expected: 7, description: 'normal mid-year' },
    { date: '2022-04-02', expected: 13, description: 'cross-month in v1' },
    { date: '2019-06-15', expected: 24, description: 'pre-2020, no prefix' },
  ]

  for (const { date, expected, description } of fixtures) {
    assert({
      given: `${date} (${description})`,
      should: `return W${expected}`,
      actual: nbfsWeekNumber(date),
      expected,
    })
  }
})

test('nbfsWeekNumber - W00 orphan days at year start', () => {
  const fixtures = [
    { date: '2027-01-01', expected: 0, description: 'Jan 1 = Friday, ISO W53 of 2026' },
    { date: '2022-01-01', expected: 0, description: 'Jan 1 = Saturday, ISO W52 of 2021' },
    { date: '2023-01-01', expected: 0, description: 'Jan 1 = Sunday, ISO W52 of 2022' },
  ]

  for (const { date, expected, description } of fixtures) {
    assert({
      given: `${date} (${description})`,
      should: 'return W00',
      actual: nbfsWeekNumber(date),
      expected,
    })
  }
})

test('nbfsWeekNumber - W53 overflow at year end', () => {
  const fixtures = [
    { date: '2025-12-29', expected: 53, description: 'Mon Dec 29, ISO W1 of 2026' },
    { date: '2024-12-31', expected: 53, description: 'Tue Dec 31, ISO W1 of 2025' },
  ]

  for (const { date, expected, description } of fixtures) {
    assert({
      given: `${date} (${description})`,
      should: 'return W53',
      actual: nbfsWeekNumber(date),
      expected,
    })
  }
})

test('nbfsWeekNumber - genuine ISO W53', () => {
  // 2026 is an ISO long year (53 weeks) — Dec 28 is genuinely ISO W53
  assert({
    given: '2026-12-28 (genuine ISO W53)',
    should: 'return W53',
    actual: nbfsWeekNumber('2026-12-28'),
    expected: 53,
  })
})

test('nbfsWeekNumber - clean Jan 1 start', () => {
  // 2024-01-01 is a Monday → ISO W01, no adjustment needed
  assert({
    given: '2024-01-01 (Monday, clean start)',
    should: 'return W01',
    actual: nbfsWeekNumber('2024-01-01'),
    expected: 1,
  })
})

test('nbfsWeekNumber - accepts PlainDate', () => {
  const date = new PlainDate(2026, 2, 15)
  assert({
    given: 'a PlainDate instance',
    should: 'return the correct week number',
    actual: nbfsWeekNumber(date),
    expected: 7,
  })
})
