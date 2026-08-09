import * as path from 'node:path'
import { SlugCollisionError, TitleCollisionError, writeStreak } from '#commands/all/streaks/lib/write.ts'
import { makeTempDir, readTextFile } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import { PlainDate, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'

const NOW = new ZonedDateTime('2026-03-05 09:15', 'America/Chicago')

test('writeStreak - writes the rule doc under active/ keyed to notebook now', async () => {
  const streaksDir = await makeTempDir({ prefix: 'streaks-' })
  const timeDir = await makeTempDir({ prefix: 'time-' })

  const result = await writeStreak(
    {
      name: 'eat-clean',
      title: 'Eat clean',
      schedule: 'daily',
      start: new PlainDate('2026-03-09'),
      end: new PlainDate('2026-04-05'),
      why: 'Food quality drives everything else.',
      rel: ['Atlas'],
      now: NOW,
      category: 'Personal Complete',
    },
    { streaksDir, timeDir },
  )

  assert({ actual: result.file, expected: path.join(streaksDir, 'active', 'eat-clean.md') })

  const content = await readTextFile(result.file)
  assert({ actual: content.includes('name: eat-clean'), expected: true })
  assert({ actual: content.includes('start: 2026-03-09'), expected: true })
  assert({ actual: content.includes('end: 2026-04-05'), expected: true })
  assert({ actual: content.includes('created: 2026-03-05'), expected: true })
  assert({ actual: content.includes('- Atlas'), expected: true })

  assert({
    given: 'a start day later than the creation day',
    should: 'note the start date in the day item',
    actual: result.dayItem,
    expected: '09:15 > streaks/eat-clean -> Started | Eat clean (starts 2026-03-09)',
  })
})

test('writeStreak - refuses a name collision across statuses', async () => {
  const streaksDir = await makeTempDir({ prefix: 'streaks-' })
  const timeDir = await makeTempDir({ prefix: 'time-' })

  const input = {
    name: 'eat-clean',
    title: 'Eat clean',
    schedule: 'daily' as const,
    start: new PlainDate('2026-03-05'),
    why: 'First write.',
    now: NOW,
    category: 'Personal Complete',
  }

  await writeStreak(input, { streaksDir, timeDir })

  let thrown: unknown
  try {
    await writeStreak({ ...input, title: 'Different title' }, { streaksDir, timeDir })
  } catch (err) {
    thrown = err
  }

  assert({ actual: thrown instanceof SlugCollisionError, expected: true })
})

test('writeStreak - refuses a title collision among active streaks', async () => {
  const streaksDir = await makeTempDir({ prefix: 'streaks-' })
  const timeDir = await makeTempDir({ prefix: 'time-' })

  const input = {
    name: 'eat-clean',
    title: 'Eat clean',
    schedule: 'daily' as const,
    start: new PlainDate('2026-03-05'),
    why: 'First write.',
    now: NOW,
    category: 'Personal Complete',
  }

  await writeStreak(input, { streaksDir, timeDir })

  let thrown: unknown
  try {
    await writeStreak({ ...input, name: 'eat-clean-2' }, { streaksDir, timeDir })
  } catch (err) {
    thrown = err
  }

  assert({
    given: 'a second streak with a different name but the same title',
    should: 'refuse — titles are the day-file join key',
    actual: thrown instanceof TitleCollisionError,
    expected: true,
  })
})
