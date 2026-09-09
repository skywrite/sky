import { mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import StreakDocument from '#shared/models/Streak/mod.ts'
import { assert, test } from '#test'
import { readInput, STREAKS_TODAY, streaksFixture } from './testHelpers.ts'

test('streak reports read existing records and share the model counting rules', async () => {
  const f = await streaksFixture()
  try {
    assert({
      given: 'a fresh notebook',
      should: 'return useful empty data without creating directories',
      actual: [await f.store.report(), await readdir(f.root)],
      expected: [{ today: STREAKS_TODAY, streaks: [], days: [], warnings: [] }, []],
    })
    const before = await f.day(STREAKS_TODAY, ['Read a chapter'])
    await f.day('2026-05-18', ['~~Read a chapter — 1d~~', '~~Read a chapter summary~~'])
    await f.day('2026-05-19', ['~~Read a chapter — 2d~~'], true)
    await f.store.create(readInput)
    const report = await f.store.report()
    assert({
      given: 'two recorded days and an unfinished current day',
      should: 'count exact titles, keep today pending, and expose day locks and definition context',
      actual: [
        report.streaks.map((s) => [s.current, s.best, s.done, s.why, s.rule]),
        report.days.map((day) => [day.date, day.ended]),
        await f.readDay(STREAKS_TODAY),
      ],
      expected: [
        [[2, 2, ['2026-05-18', '2026-05-19'], readInput.why, readInput.rule]],
        [
          ['2026-05-18', false],
          ['2026-05-19', true],
          [STREAKS_TODAY, false],
        ],
        before,
      ],
    })
  } finally {
    await f.dispose()
  }
})

test('completion writes preserve other day bytes and safely undo only their own saved version', async () => {
  const f = await streaksFixture()
  try {
    await f.store.create(readInput)
    const before = await f.day(STREAKS_TODAY, ['Read a chapter — 2d', 'Walk outside'])
    const saved = await f.store.completion('read-a-chapter', { date: STREAKS_TODAY, done: true, expectedDone: false })
    assert({
      given: 'a check-in on an existing decorated item',
      should: 'strike exactly that line',
      actual: await f.readDay(STREAKS_TODAY),
      expected: before.replace('- Read a chapter — 2d', '- ~~Read a chapter — 2d~~'),
    })
    await f.store.undo(saved.undoId!)
    assert({
      given: 'Undo before any later changes',
      should: 'restore all original bytes',
      actual: await f.readDay(STREAKS_TODAY),
      expected: before,
    })
    const next = await f.store.completion('read-a-chapter', { date: STREAKS_TODAY, done: true, expectedDone: false })
    const changed = (await f.readDay(STREAKS_TODAY)) + '\nA later note.\n'
    await writeFile(f.file(STREAKS_TODAY), changed)
    const refused = await f.post('/undo', { id: next.undoId })
    assert({
      given: 'a later manual edit',
      should: 'reject stale Undo and preserve the new content',
      actual: [refused.status, await f.readDay(STREAKS_TODAY)],
      expected: [409, changed],
    })
    const removed = await f.store.completion('read-a-chapter', { date: STREAKS_TODAY, done: false, expectedDone: true })
    const ended = (await f.readDay(STREAKS_TODAY)).replace('started: 08:00', 'started: 08:00\nended: 21:00')
    await writeFile(f.file(STREAKS_TODAY), ended)
    assert({
      given: 'a day ended after a completion removal',
      should: 'keep even Undo read-only',
      actual: [(await f.post('/undo', { id: removed.undoId })).status, await f.readDay(STREAKS_TODAY)],
      expected: [409, ended],
    })
  } finally {
    await f.dispose()
  }
})

test('a first check-in adds only its missing line or section to an existing open day', async () => {
  const f = await streaksFixture()
  try {
    await f.store.create(readInput)
    const empty = await f.day(STREAKS_TODAY)
    await f.store.completion('read-a-chapter', { date: STREAKS_TODAY, done: true, expectedDone: false })
    assert({
      given: 'an empty Streaks list',
      should: 'fill its existing slot and leave references untouched',
      actual: await f.readDay(STREAKS_TODAY),
      expected: empty.replace('## Streaks\n\n-', '## Streaks\n\n- ~~Read a chapter~~'),
    })
    const noSection = empty.replace('## Streaks\n\n-\n\n', '')
    await writeFile(f.file(STREAKS_TODAY), noSection)
    await f.store.completion('read-a-chapter', { date: STREAKS_TODAY, done: true, expectedDone: false })
    assert({
      given: 'a day without a Streaks section',
      should: 'insert the section before Complete without reserializing the day',
      actual: await f.readDay(STREAKS_TODAY),
      expected: noSection.replace('## Personal Complete', '## Streaks\n\n- ~~Read a chapter~~\n\n## Personal Complete'),
    })
  } finally {
    await f.dispose()
  }
})

test('archive preserves history and Undo restores the original planned end', async () => {
  const f = await streaksFixture()
  try {
    await f.store.create({ ...readInput, end: '2026-06-01' })
    await f.day('2026-05-18', ['~~Read a chapter~~'])
    await f.day('2026-05-19', ['~~Read a chapter~~'])
    const original = (await f.store.report()).streaks[0]
    const content = await readFile(path.join(f.root, original.relativePath), 'utf8')
    const archived = await f.store.archive(original.name, { revision: original.revision })
    const view = (await f.store.report()).streaks[0]
    assert({
      given: 'a streak with a future planned end',
      should: 'move it to archived and clamp the end without changing recorded completions',
      actual: [view.status, view.end, view.done, await readdir(path.join(f.root, 'streaks/active'))],
      expected: ['archived', STREAKS_TODAY, ['2026-05-18', '2026-05-19'], []],
    })
    await f.store.completion(original.name, { date: '2026-05-19', done: false, expectedDone: true })
    await f.store.undo(archived.undoId!)
    assert({
      given: 'Undo after an independent historical completion edit',
      should: 'restore the original rule bytes and leave the day correction',
      actual: [
        await readFile(path.join(f.root, original.relativePath), 'utf8'),
        (await f.store.report()).streaks[0].done,
      ],
      expected: [content, ['2026-05-18']],
    })
    await f.store.archive(original.name, { revision: original.revision })
    assert({
      given: 'an archived title',
      should: 'reserve it so a new streak cannot absorb its history',
      actual: (await f.post('/create', { ...readInput, title: 'READ A CHAPTER' })).status,
      expected: 409,
    })
  } finally {
    await f.dispose()
  }
})

test('reports warn about malformed and ambiguous definitions and render narrative as safe HTML', async () => {
  const f = await streaksFixture()
  try {
    await f.store.create({
      ...readInput,
      rule: '<script>alert(1)</script>\n\n[unsafe](javascript:alert%281%29)\n\n[hidden](java\tscript:alert%281%29)\n\n[Book](https://example.com/book)',
    })
    const view = (await f.store.report()).streaks[0]
    const file = path.join(f.root, view.relativePath)
    const source = await readFile(file, 'utf8')
    const duplicate = StreakDocument.fromMarkdown(source).updateYaml({ name: 'another-reader' }).toMarkdown()
    await writeFile(path.join(f.root, 'streaks/active/another-reader.md'), duplicate)
    await writeFile(path.join(f.root, 'streaks/active/broken.md'), '---\nname: [broken]\n---\n')
    await f.day(STREAKS_TODAY, ['Read a chapter', '~~Read a chapter~~'])
    const report = await f.store.report()
    assert({
      given: 'raw HTML, unsafe links, ambiguous titles, and duplicate day items',
      should: 'escape markup, retain safe links, expose warnings, and use the same first-item rule as stats',
      actual: [
        view.bodyHtml.includes('<script>'),
        /href="javascript:/i.test(view.bodyHtml),
        view.bodyHtml.includes('href="https://example.com/book"'),
        report.warnings.some((warning) => warning.includes('Could not read streak')),
        report.warnings.some((warning) => warning.includes('More than one streak')),
        report.warnings.some((warning) => warning.includes('duplicate items')),
        report.streaks.map((streak) => [streak.done, streak.current]),
        (await f.post('/read-a-chapter/completion', { date: STREAKS_TODAY, done: true, expectedDone: false })).status,
      ],
      expected: [
        false,
        false,
        true,
        true,
        true,
        true,
        [
          [[], 0],
          [[], 0],
        ],
        409,
      ],
    })
  } finally {
    await f.dispose()
  }
})

test('completion paths refuse symlinks instead of changing files outside the notebook', async () => {
  const f = await streaksFixture()
  try {
    await f.store.create(readInput)
    const external = path.join(f.temporary, 'outside.md')
    const before = '---\ndate: 2026-05-20\n---\n\n## Streaks\n\n- Read a chapter\n'
    await writeFile(external, before)
    await mkdir(path.dirname(f.file(STREAKS_TODAY)), { recursive: true })
    await symlink(external, f.file(STREAKS_TODAY))
    assert({
      given: 'a day file symlink to outside the notebook',
      should: 'refuse the write and warn in the report',
      actual: [
        (await f.post('/read-a-chapter/completion', { date: STREAKS_TODAY, done: true, expectedDone: false })).status,
        (await f.store.report()).warnings.length,
        await readFile(external, 'utf8'),
      ],
      expected: [400, 1, before],
    })
  } finally {
    await f.dispose()
  }
})

test('concurrent check-ins save once and archive Undo preserves later document edits', async () => {
  const f = await streaksFixture()
  try {
    await f.store.create(readInput)
    await f.day(STREAKS_TODAY, ['Read a chapter'])
    const input = { date: STREAKS_TODAY, done: true, expectedDone: false }
    const results = await Promise.all([
      f.post('/read-a-chapter/completion', input),
      f.post('/read-a-chapter/completion', input),
    ])
    assert({
      given: 'two stale tabs check off the same day at once',
      should: 'serialize the app writes and accept only one expected state',
      actual: [results.map((response) => response.status).sort(), (await f.store.report()).streaks[0].done],
      expected: [[200, 409], [STREAKS_TODAY]],
    })
    const original = (await f.store.report()).streaks[0]
    const stale = await f.post('/read-a-chapter/archive', { revision: 'old-revision' })
    const archived = await f.store.archive(original.name, { revision: original.revision })
    const view = (await f.store.report()).streaks[0]
    const file = path.join(f.root, view.relativePath)
    const updated = (await readFile(file, 'utf8')) + '\nKeep this later definition note.\n'
    await writeFile(file, updated)
    const undone = await f.post('/undo', { id: archived.undoId })
    assert({
      given: 'a stale archive revision and a later edit to an archived document',
      should: 'reject both stale actions without overwriting the archived definition or recreating the active one',
      actual: [
        stale.status,
        undone.status,
        await readFile(file, 'utf8'),
        await readdir(path.join(f.root, 'streaks/active')),
      ],
      expected: [409, 409, updated, []],
    })
  } finally {
    await f.dispose()
  }
})
