import * as path from 'node:path'
import { assert, test } from '#test'
import dayDir from './dayDir.ts'

test(dayDir.name, () => {
  // Fixtures: YMD string -> expected path components
  const FIXTURES: Record<string, string[]> = {
    '2019-04-05': ['2019', '04', '01-07', '04-05'],
    '2021-05-31': ['2021', '05', '31-06', '05-31'],
    '2021-06-06': ['2021', '05', '31-06', '06-06'],
    '2022-01-01': ['2022', '01', '01-02', '01-01'],
    '2022-01-02': ['2022', '01', '01-02', '01-02'],
    '2022-03-21': ['2022', '03', '21-27', '03-21'],
    '2022-03-27': ['2022', '03', '21-27', '03-27'],
    '2022-04-02': ['2022', '03', '28-03', '04-02'],
    '2022-09-01': ['2022', '08', '29-04', '09-01'],
    '2022-09-05': ['2022', '09', '05-11', '09-05'],
    '2022-12-31': ['2022', '12', '26-31', '12-31'],
    '2023-01-01': ['2023', '01', '01-01', '01-01'],
  }

  for (const [date, paths] of Object.entries(FIXTURES)) {
    assert({
      given: `the date ${date}`,
      should: 'return the correct day directory',
      actual: dayDir(date),
      expected: path.join(...paths),
    })
  }
})

test('dayDir rejects invalid date format', () => {
  const invalidInputs = ['2022/03/21', 'March 21 2022', '21-03-2022', '2022-3-21']

  for (const input of invalidInputs) {
    let threw = false
    try {
      dayDir(input)
    } catch {
      threw = true
    }
    assert({
      given: `invalid date format "${input}"`,
      should: 'throw an error',
      actual: threw,
      expected: true,
    })
  }
})
