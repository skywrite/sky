import { assert, test } from '#test'
import parseDateFromDayPath from './parseDateFromDayPath.ts'

test('parseDateFromDayPath - normal paths', () => {
  const fixtures = [
    { path: 'time/2026/02/W07/02.15/day.md', expected: '2026-02-15' },
    { path: 'time/2022/03/W13/04.02/day.md', expected: '2022-04-02' },
    { path: 'time/2019/06/W24/06.15/day.md', expected: '2019-06-15' },
    { path: 'time/2027/01/W00/01.01/day.md', expected: '2027-01-01' },
    { path: 'time/2025/12/W53/12.29/day.md', expected: '2025-12-29' },
  ]

  for (const { path, expected } of fixtures) {
    assert({
      given: path,
      should: `parse to ${expected}`,
      actual: parseDateFromDayPath(path).toString(),
      expected,
    })
  }
})

test('parseDateFromDayPath - with base path prefix', () => {
  const fullPath = '/some/base/path/time/2026/02/W07/02.15/day.md'
  assert({
    given: 'path with base prefix',
    should: 'parse correctly',
    actual: parseDateFromDayPath(fullPath).toString(),
    expected: '2026-02-15',
  })
})

test('parseDateFromDayPath - nested files under day dir', () => {
  const fullPath = 'time/2022/03/W13/04.02/notes/project-ideas.md'
  assert({
    given: 'path to nested file under day dir',
    should: 'parse the date from MM.DD segment',
    actual: parseDateFromDayPath(fullPath).toString(),
    expected: '2022-04-02',
  })
})

test('parseDateFromDayPath - cross-month day under different month dir', () => {
  // Feb 1 lives under January's W05 because Thursday is in January
  const fullPath = 'time/2026/01/W05/02.01/day.md'
  assert({
    given: 'cross-month day (Feb 1 under January)',
    should: 'parse the actual date from MM.DD, not the month dir',
    actual: parseDateFromDayPath(fullPath).toString(),
    expected: '2026-02-01',
  })
})

test('parseDateFromDayPath - throws on invalid paths', () => {
  const invalidPaths = [
    '/some/path/without/time/directory.md',
    'time/2022/03/W13/day.md', // Missing MM.DD
    'time/2022/day.md', // Missing month, week and MM.DD
  ]

  for (const invalidPath of invalidPaths) {
    let didThrow = false
    try {
      parseDateFromDayPath(invalidPath)
    } catch {
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
