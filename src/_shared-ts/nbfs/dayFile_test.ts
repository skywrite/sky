import { assert, test } from '#test'
import * as path from 'node:path'
import dayFile, { FILE_DAY } from './dayFile.ts'

test(dayFile.name, () => {
  // Fixtures: YMD string -> expected path components
  const FIXTURES: Record<string, string[]> = {
    '2022-03-27': ['2022', '03', '21-27', '03-27', FILE_DAY],
  }

  for (const [date, paths] of Object.entries(FIXTURES)) {
    assert({
      given: `the date ${date}`,
      should: 'return the correct day file path',
      actual: dayFile(date),
      expected: path.join(...paths),
    })
  }
})
