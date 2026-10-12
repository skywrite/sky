import { rm } from 'node:fs/promises'
import { makeTempDir } from '#shared/fs/mod.ts'
import { readDay } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import writeDayItems from './writeDayItems.ts'

test('writeDayItems creates the day file when the day has none', async () => {
  const timeDir = await makeTempDir({ prefix: 'write-day-items-test-' })
  const day = new PlainDate('2026-04-11')
  try {
    await writeDayItems(day, 'Professional Complete', '10:00 > Review Atlas', { timeDir })
    const doc = await readDay(day, timeDir)
    assert({
      given: 'an item added to a day that has no day file',
      should: 'create the day, unstarted, with the item in its collection',
      actual: {
        started: doc.started,
        items: doc.lists.find((list) => list.title === 'Professional Complete')?.items,
      },
      expected: { started: undefined, items: ['10:00 > Review Atlas'] },
    })
  } finally {
    await rm(timeDir, { recursive: true, force: true })
  }
})
