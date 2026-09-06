import { mkdtemp, rm } from 'node:fs/promises'
import * as path from 'node:path'
import { outputFile } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { gatherHealthData, gatherWeekHealthData } from './_health.ts'

test('health summaries read annual data across years, with unit headers and legacy fallback', async () => {
  const root = await mkdtemp('/tmp/sky-health-annual-')
  const time = path.join(root, 'time')
  const put = (file: string, contents: string) => outputFile(path.join(root, file), contents)
  try {
    await put(
      'data/tracking/2030/weight.csv',
      'date,time,lbs (lbs),notes\n2030-12-29,8:00,180,outside\n2030-12-30,8:00,181,\n',
    )
    await put(
      'data/tracking/2031/weight.csv',
      'date,time,lbs (lbs),notes\n2031-01-01,8:00,182,\n2031-01-01,9:00,183,\n2031-01-06,8:00,184,outside\n',
    )
    await put('time/2030/W53/_tracking/health/weight.csv', 'day,lbs\nW,999\n')
    await put('time/2031/W01/_tracking/health/sleep.csv', 'day,range,duration (hrs)\nW,22:00-6:00,8\n')
    const day = await gatherHealthData(new PlainDate('2031-01-01'), time)
    assert({
      given: 'annual measurements and legacy sleep data',
      should: 'read the latest weight and the matching sleep',
      actual: day,
      expected: { sleep: { range: '22:00-6:00', duration: '8' }, weight: '183' },
    })
    const week = await gatherWeekHealthData(new PlainDate('2030-12-30'), time)
    assert({
      given: 'a week crossing New Year',
      should: 'include both annual files without unrelated dates or duplicate legacy weight',
      actual: [
        week.filter((s) => s.name === 'weight').length,
        week.some((s) => s.csv.includes('outside')),
        week.some((s) => s.csv.includes('999')),
      ],
      expected: [2, false, false],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
