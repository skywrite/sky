import { readFile, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import DayDocument from '#shared/models/Day/mod.ts'
import StreakDocument from '#shared/models/Streak/mod.ts'
import { assert, test } from '#test'
import { readInput, STREAKS_TODAY, streaksFixture } from './testHelpers.ts'

test('inferred categories persist from creation through archive and explicit corrections take precedence', async () => {
  let calls = 0
  const f = await streaksFixture(undefined, async () => {
    calls++
    return 'Professional'
  })
  try {
    await f.store.create({ ...readInput, why: 'Develop skills for work.' })
    const original = (await f.store.report()).streaks[0]
    const file = path.join(f.root, original.relativePath)
    const before = await readFile(file, 'utf8')
    await f.day(STREAKS_TODAY)
    const archived = await f.store.archive(original.name, { revision: original.revision })
    assert({
      given: 'a streak classified as Professional when created',
      should: 'reuse the saved category for the archive record without another inference',
      actual: [
        StreakDocument.fromMarkdown(before).category,
        (await f.store.report()).streaks[0].category,
        DayDocument.fromMarkdown(await f.readDay(STREAKS_TODAY)).lists.find(
          (list) => list.title === 'Professional Complete',
        )?.items,
        calls,
      ],
      expected: ['Professional', 'Professional', ['14:30 > streaks/read-a-chapter -> Archived | Read a chapter'], 1],
    })
    await f.store.undo(archived.undoId!)
    await f.store.setCategory(original.name, { revision: original.revision, category: 'Personal' })
    const corrected = (await f.store.report()).streaks[0]
    assert({
      given: 'a manual correction followed by a stale category edit',
      should: 'retain the correction and reject the stale revision',
      actual: [
        corrected.category,
        (await f.post(`/${original.name}/category`, { revision: original.revision, category: 'Professional' })).status,
        calls,
      ],
      expected: ['Personal', 409, 1],
    })
    await f.store.archive(corrected.name, { revision: corrected.revision })
    assert({
      given: 'archiving after a category correction',
      should: 'file the entry under the chosen category',
      actual: DayDocument.fromMarkdown(await f.readDay(STREAKS_TODAY))
        .lists.find((list) => list.title === 'Personal Complete')
        ?.items.at(-1),
      expected: '14:30 > streaks/read-a-chapter -> Archived | Read a chapter',
    })
  } finally {
    await f.dispose()
  }
})

test('legacy streaks are classified on archive and Undo restores their original metadata', async () => {
  let calls = 0
  const f = await streaksFixture(undefined, async () => {
    calls++
    return 'Professional'
  })
  try {
    await f.store.create({ ...readInput, category: 'Personal' })
    const file = path.join(f.root, 'streaks/active/read-a-chapter.md')
    const legacy = (await readFile(file, 'utf8')).replace('category: Personal\n', '')
    await writeFile(file, legacy)
    const original = (await f.store.report()).streaks[0]
    assert({
      given: 'viewing a legacy streak',
      should: 'leave classification until a mutation',
      actual: [original.category, calls],
      expected: [null, 0],
    })
    const archived = await f.store.archive(original.name, { revision: original.revision })
    assert({
      given: 'archiving a legacy streak',
      should: 'infer and save its category once',
      actual: [(await f.store.report()).streaks[0].category, calls],
      expected: ['Professional', 1],
    })
    await f.store.undo(archived.undoId!)
    assert({
      given: 'Undo of legacy classification and archive',
      should: 'restore the exact prior document',
      actual: await readFile(file, 'utf8'),
      expected: legacy,
    })
  } finally {
    await f.dispose()
  }
})

test('unavailable classification does not prevent creation or archive and never becomes a saved guess', async () => {
  const f = await streaksFixture(undefined, async () => {
    throw new Error('Mock unavailable model')
  })
  try {
    const created = await f.store.create(readInput)
    const streak = (await f.store.report()).streaks[0]
    const archived = await f.store.archive(streak.name, { revision: streak.revision })
    assert({
      given: 'a notebook without an available model',
      should: 'save the streak and record the archive with a visible fallback, leaving category unset',
      actual: [
        created.message.includes('Category could not be determined'),
        archived.message.includes('recorded in Personal Complete'),
        (await f.store.report()).streaks[0].category,
      ],
      expected: [true, true, null],
    })
  } finally {
    await f.dispose()
  }
})

test('an explicit category edit during archive inference is preserved', async () => {
  let signalStarted!: () => void
  let finish!: (category: 'Professional') => void
  const started = new Promise<void>((resolve) => {
    signalStarted = resolve
  })
  const inference = new Promise<'Professional'>((resolve) => {
    finish = resolve
  })
  const f = await streaksFixture(undefined, async () => {
    signalStarted()
    return inference
  })
  try {
    await f.store.create({ ...readInput, category: 'Personal' })
    const file = path.join(f.root, 'streaks/active/read-a-chapter.md')
    await writeFile(file, (await readFile(file, 'utf8')).replace('category: Personal\n', ''))
    const original = (await f.store.report()).streaks[0]
    const archiving = f.post(`/${original.name}/archive`, { revision: original.revision })
    await started
    await f.store.setCategory(original.name, { revision: original.revision, category: 'Personal' })
    finish('Professional')
    const response = await archiving
    const current = (await f.store.report()).streaks[0]
    assert({
      given: 'a manual correction while inference is pending',
      should: 'reject the stale archive and keep the correction',
      actual: [response.status, current.status, current.category],
      expected: [409, 'active', 'Personal'],
    })
  } finally {
    finish('Professional')
    await f.dispose()
  }
})
