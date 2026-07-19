import { assert, test } from '#test'
import * as path from 'node:path'
import weekDir from './weekDir.ts'

test(weekDir.name, () => {
  // Fixtures: YMD string -> expected path components
  const FIXTURES: Record<string, string[]> = {
    '2019-04-05': ['2019', '04', '01-07'],
    '2021-05-31': ['2021', '05', '31-06'],
    '2021-06-06': ['2021', '05', '31-06'],
    '2022-01-01': ['2022', '01', '01-02'],
    '2022-01-02': ['2022', '01', '01-02'],
    '2022-03-21': ['2022', '03', '21-27'],
    '2022-03-27': ['2022', '03', '21-27'],
    '2022-04-02': ['2022', '03', '28-03'],
    '2022-09-01': ['2022', '08', '29-04'],
    '2022-09-05': ['2022', '09', '05-11'],
    '2022-12-31': ['2022', '12', '26-31'],
    '2023-01-01': ['2023', '01', '01-01'],
  }

  for (const [date, paths] of Object.entries(FIXTURES)) {
    assert({
      given: `the date ${date}`,
      should: 'return the correct week directory',
      actual: weekDir(date),
      expected: path.join(...paths),
    })
  }
})
