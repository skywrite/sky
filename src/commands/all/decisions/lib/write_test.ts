import * as path from 'node:path'
import { writeDecision, SlugCollisionError } from '#commands/all/decisions/lib/write.ts'
import { makeTempDir, readTextFile } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import { ZonedDateTime } from '#universal/dates/nbdt/mod.ts'

const NOW = new ZonedDateTime('2026-03-05 09:15', 'America/Chicago')

test('writeDecision - writes the document under pending/ keyed to notebook now', async () => {
  const decisionsDir = await makeTempDir({ prefix: 'decisions-' })
  const timeDir = await makeTempDir({ prefix: 'time-' })

  const result = await writeDecision(
    {
      name: 'Choose-Vendor',
      title: 'Choose Vendor',
      context: 'Two vendors are in play.',
      desiredOutcomes: 'A signed contract.',
      target: '2026-03-20',
      rel: ['Atlas'],
      now: NOW,
      category: 'Professional Complete',
    },
    { decisionsDir, timeDir },
  )

  assert({
    actual: result.file,
    expected: path.join(decisionsDir, '2026', 'pending', '03', 'Choose-Vendor.md'),
  })

  const content = await readTextFile(result.file)
  assert({ actual: content.includes('name: Choose-Vendor'), expected: true })
  assert({ actual: content.includes('created: 2026-03-05'), expected: true })
  assert({ actual: content.includes('target: 2026-03-20'), expected: true })
  assert({ actual: content.includes('- Atlas'), expected: true })
  assert({ actual: content.includes('# Choose Vendor'), expected: true })

  assert({
    actual: result.dayItem,
    expected: '09:15 > decisions/Choose-Vendor -> Identified | Choose Vendor',
  })
})

test('writeDecision - refuses a slug collision instead of overwriting', async () => {
  const decisionsDir = await makeTempDir({ prefix: 'decisions-' })
  const timeDir = await makeTempDir({ prefix: 'time-' })

  const input = {
    name: 'Choose-Vendor',
    title: 'Choose Vendor',
    context: 'First write.',
    desiredOutcomes: 'Outcomes.',
    now: NOW,
    category: 'Professional Complete',
  }

  await writeDecision(input, { decisionsDir, timeDir })

  let thrown: unknown
  try {
    await writeDecision({ ...input, context: 'Second write.' }, { decisionsDir, timeDir })
  } catch (err) {
    thrown = err
  }

  assert({ actual: thrown instanceof SlugCollisionError, expected: true })

  const content = await readTextFile(path.join(decisionsDir, '2026', 'pending', '03', 'Choose-Vendor.md'))
  assert({
    given: 'a colliding second write',
    should: 'leave the first document untouched',
    actual: content.includes('First write.'),
    expected: true,
  })
})
