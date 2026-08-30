import * as path from 'node:path'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import dayDir from './dayDir.ts'
import dayFile from './dayFile.ts'
import weekDir from './weekDir.ts'

test('dayFile accepts PlainDate and YMD string', () => {
  const plainDate = new PlainDate('2025-08-27')
  const ymdString = '2025-08-27'

  const resultPlainDate = dayFile(plainDate)
  const resultString = dayFile(ymdString)

  assert({
    given: 'same date as PlainDate and YMD string',
    should: 'produce same file path',
    actual: resultPlainDate,
    expected: resultString,
  })

  assert({
    given: 'dayFile with PlainDate',
    should: 'end with day.md',
    actual: resultPlainDate.endsWith('day.md'),
    expected: true,
  })
})

test('dayDir accepts PlainDate and YMD string', () => {
  const plainDate = new PlainDate('2025-08-27')
  const ymdString = '2025-08-27'

  const resultPlainDate = dayDir(plainDate)
  const resultString = dayDir(ymdString)

  assert({
    given: 'same date as PlainDate and YMD string',
    should: 'produce same directory path',
    actual: resultPlainDate,
    expected: resultString,
  })

  assert({
    given: 'dayDir with PlainDate 2025-08-27',
    should: 'include day 27 in path',
    actual: resultPlainDate.includes('27'),
    expected: true,
  })
})

test('weekDir accepts PlainDate and YMD string', () => {
  const plainDate = new PlainDate('2025-08-27')
  const ymdString = '2025-08-27'

  const resultPlainDate = weekDir(plainDate)
  const resultString = weekDir(ymdString)

  assert({
    given: 'same date as PlainDate and YMD string',
    should: 'produce same week directory',
    actual: resultPlainDate,
    expected: resultString,
  })

  assert({
    given: 'weekDir with PlainDate in August 2025',
    should: 'build the year and a week number',
    actual: /^2025\/W\d{2}$/.test(resultPlainDate),
    expected: true,
  })
})

test('nbfs functions handle month boundary correctly', () => {
  // Test March 1, 2025 which is in a week that starts in February (Feb 24-Mar 2)
  const plainDate = new PlainDate('2025-03-01')

  assert({
    given: 'PlainDate that spills into next month (March 1, 2025)',
    should: 'carry its own month in the MM-DD day dir',
    actual: dayDir(plainDate),
    expected: path.join('2025', 'W09', '03-01'),
  })
})

test('nbfs functions handle pre-2020 dates', () => {
  const plainDate = new PlainDate('2019-08-27')
  const weekDirResult = weekDir(plainDate)

  assert({
    given: 'PlainDate before 2020',
    should: 'build a plain year path like any other date',
    actual: weekDirResult,
    expected: path.join('2019', 'W35'),
  })
})
