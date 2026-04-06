import { assert, test } from '#test'
import * as path from 'node:path'
import parseDateFromDayPath from './parseDateFromDayPath.ts'

test(parseDateFromDayPath.name, () => {
  const FIXTURES = [
    {
      path: path.join('time', '_pre-2020', '2019', '04', '01-07', '05', 'day.md'),
      expected: '2019-04-05',
    },
    {
      path: path.join('time', '2021', '05', '31-06', '31', 'meeting-with-bob.md'),
      expected: '2021-05-31',
    },
    {
      path: path.join('time', '2021', '05', '31-06', 'x06', 'standup.md'),
      expected: '2021-06-06', // x06 means June 6th
    },
    {
      path: path.join('time', '2022', '01', '01-02', '01', 'day.md'),
      expected: '2022-01-01',
    },
    {
      path: path.join('time', '2022', '01', '01-02', '02', 'notes', 'project-ideas.md'),
      expected: '2022-01-02',
    },
    {
      path: path.join('time', '2022', '03', '21-27', '21', 'day.md'),
      expected: '2022-03-21',
    },
    {
      path: path.join('time', '2022', '03', '21-27', '27', 'event-conference.md'),
      expected: '2022-03-27',
    },
    {
      path: path.join('time', '2022', '03', '28-03', 'x02', 'day.md'),
      expected: '2022-04-02', // x02 means April 2nd
    },
    {
      path: path.join('time', '2022', '08', '29-04', 'x01', 'team-sync.md'),
      expected: '2022-09-01', // x01 means September 1st
    },
    {
      path: path.join('time', '2022', '12', '26-31', '31', 'day.md'),
      expected: '2022-12-31',
    },
    {
      path: path.join('time', '2023', '01', '01-01', '01', 'subfolder', 'nested-note.md'),
      expected: '2023-01-01',
    },
  ]

  for (const fixture of FIXTURES) {
    const fullPath = path.join('/some/base/path', fixture.path)
    const result = parseDateFromDayPath(fullPath)

    assert({
      given: `path ${fixture.path}`,
      should: `parse to ${fixture.expected}`,
      actual: result.toString(),
      expected: fixture.expected,
    })
  }
})

test(`${parseDateFromDayPath.name} - year rollover`, () => {
  // Test year rollover: Dec 31st week with x01 for Jan 1st
  const pathStr = path.join('time', '2022', '12', '26-31', 'x01', 'day.md')
  const fullPath = path.join('/some/base/path', pathStr)
  const result = parseDateFromDayPath(fullPath)

  assert({
    given: 'a December path with x01 (Jan 1st spillover)',
    should: 'increment year and month to next year',
    actual: result.toString(),
    expected: '2023-01-01',
  })
})

test(`${parseDateFromDayPath.name} - throws on invalid path`, () => {
  const invalidPaths = [
    '/some/path/without/time/directory.md',
    '/some/path/time/2022/03/day.md', // Missing week and day
    '/some/path/time/2022/day.md', // Missing month, week, and day
  ]

  for (const invalidPath of invalidPaths) {
    let didThrow = false
    try {
      parseDateFromDayPath(invalidPath)
    } catch (error) {
      didThrow = true
    }

    assert({
      given: `invalid path ${invalidPath}`,
      should: 'throw an error',
      actual: didThrow,
      expected: true,
    })
  }
})
