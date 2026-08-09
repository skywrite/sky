import * as path from 'node:path'
import { writeIdea, SlugCollisionError } from '#commands/all/ideas/lib/write.ts'
import { makeTempDir, readTextFile } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import { ZonedDateTime } from '#universal/dates/nbdt/mod.ts'

const NOW = new ZonedDateTime('2026-03-05 09:15', 'America/Chicago')

test('writeIdea - writes the document under draft/ keyed to notebook now', async () => {
  const ideasDir = await makeTempDir({ prefix: 'ideas-' })
  const timeDir = await makeTempDir({ prefix: 'time-' })

  const result = await writeIdea(
    {
      name: 'AI-Coach',
      title: 'AI Coach',
      body: 'An AI coach that reviews the day.',
      rel: ['Atlas'],
      now: NOW,
      category: 'Personal Complete',
    },
    { ideasDir, timeDir },
  )

  assert({
    actual: result.file,
    expected: path.join(ideasDir, '2026', 'draft', '03', 'AI-Coach.md'),
  })

  const content = await readTextFile(result.file)
  assert({ actual: content.includes('name: AI-Coach'), expected: true })
  assert({ actual: content.includes('created: 2026-03-05'), expected: true })
  assert({ actual: content.includes('- Atlas'), expected: true })
  assert({ actual: content.includes('# AI Coach'), expected: true })

  assert({
    actual: result.dayItem,
    expected: '09:15 > ideas/AI-Coach -> New idea | AI Coach',
  })
})

test('writeIdea - refuses a slug collision instead of overwriting', async () => {
  const ideasDir = await makeTempDir({ prefix: 'ideas-' })
  const timeDir = await makeTempDir({ prefix: 'time-' })

  const input = {
    name: 'AI-Coach',
    title: 'AI Coach',
    body: 'First write.',
    now: NOW,
    category: 'Personal Complete',
  }

  await writeIdea(input, { ideasDir, timeDir })

  let thrown: unknown
  try {
    await writeIdea({ ...input, body: 'Second write.' }, { ideasDir, timeDir })
  } catch (err) {
    thrown = err
  }

  assert({ actual: thrown instanceof SlugCollisionError, expected: true })

  const content = await readTextFile(path.join(ideasDir, '2026', 'draft', '03', 'AI-Coach.md'))
  assert({
    given: 'a colliding second write',
    should: 'leave the first document untouched',
    actual: content.includes('First write.'),
    expected: true,
  })
})
