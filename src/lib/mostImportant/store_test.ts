import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { readDayMostImportant } from '#commands/lib/notebookContext.ts'
import DayDocument from '#shared/models/Day/document/mod.ts'
import { Document } from '#shared/models/Markdown/mod.ts'
import { dayDir, dayFile } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { saveMostImportant, setMostImportantComplete, type MIStorage } from './store.ts'
import type { MIDraft } from './types.ts'

const DAY = new PlainDate('2030-06-17')
const DRAFT: MIDraft = {
  summary: 'Send Atlas [draft]: pricing proposal',
  dueBy: '',
  body: 'Send Jane a pricing proposal for feedback.\n\n## Why this matters\n\nThe team needs a concrete option to evaluate before deciding.\n\n## Done when\n\nJane has the proposal and knows it is ready for feedback.\n',
}
async function fixture(run: (storage: MIStorage, root: string, file: string) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-mi-store-'))
  const timeDir = path.join(root, 'time')
  const file = path.join(timeDir, dayFile(DAY))
  const storage: MIStorage = { timeDir, stateDir: path.join(root, 'state') }
  try {
    await run(storage, root, file)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('MI acceptance creates a readable file and an untimed day item once, including retries', async () => {
  await fixture(async (storage, _root, file) => {
    const request = crypto.randomUUID()
    const first = await saveMostImportant(storage, DAY, DRAFT, request, {
      rel: ['people/Jane-Doe', 'projects/Atlas'],
      tags: 'Work/Pricing; Planning',
    })
    const again = await saveMostImportant(storage, DAY, DRAFT, request)
    const content = await readFile(file, 'utf8')
    const day = DayDocument.fromMarkdown(content)
    const mi = Document.fromMarkdown(await readFile(path.join(path.dirname(file), first.file), 'utf8'))
    assert({
      given: 'an accepted draft on a day with no existing file, then the same request again',
      should: 'create one task and one discoverable document without scheduling or starting the day',
      actual: {
        same: first.file === again.file,
        name: path.basename(first.file).startsWith('MI1_Send-Atlas'),
        items: day.lists.find((list) => list.title === 'Most Important')?.items,
        started: Boolean(day.started),
        complete: mi.yaml['complete'],
        title: mi.yaml['summary'],
        headers: mi.yaml,
        found: (await readDayMostImportant(DAY, storage.timeDir)).length,
      },
      expected: {
        same: true,
        name: true,
        items: [`MI/1 -> [Send Atlas \\[draft\\]: pricing proposal](${first.file})`],
        started: false,
        complete: null,
        title: DRAFT.summary,
        headers: {
          summary: DRAFT.summary,
          complete: null,
          dateStarted: null,
          rel: ['people/Jane-Doe', 'projects/Atlas'],
          tags: 'Work/Pricing; Planning',
        },
        found: 1,
      },
    })
    let refused = false
    try {
      await saveMostImportant(storage, DAY, { ...DRAFT, summary: 'A different task' }, request)
    } catch {
      refused = true
    }
    assert({
      given: 'a retry key used for different content',
      should: 'refuse instead of silently creating a second MI',
      actual: refused,
      expected: true,
    })
  })
})

test('old MI names and every original header remain readable and editable without losing custom metadata', async () => {
  await fixture(async (storage, _root, file) => {
    const dir = path.join(path.dirname(file), 'most-important')
    await mkdir(dir, { recursive: true })
    const examples = [
      {
        name: 'MI1.md',
        yaml: { summary: null, complete: null, dateStarted: null, rel: null, tags: null },
      },
      {
        name: 'MI7_Review-Atlas.md',
        yaml: {
          summary: 'Review Atlas: "v2" #pricing',
          complete: false,
          dateStarted: '2030-06-16',
          rel: ['people/Jane-Doe', 'projects/Atlas'],
          tags: 'Work/Pricing; Planning',
          custom: { owner: 'Jane Doe', status: 'in progress' },
        },
      },
      {
        name: '2030-06-17_123456_Review-the-proposal.md',
        yaml: {
          summary: 'Review the proposal',
          complete: true,
          dateStarted: '2030-06-15',
          rel: 'projects/Widget-V2',
          tags: ['Work', 'Planning'],
          dueBy: 'Friday',
        },
      },
    ]
    for (const example of examples) {
      const doc = Document.fromMarkdown('# Existing task\n\n## Reflection\n\nKeep these working notes.\n')
      Object.assign(doc.yaml, example.yaml)
      await writeFile(path.join(dir, example.name), doc.toMarkdown())
    }
    const found = await readDayMostImportant(DAY, storage.timeDir)
    for (const example of examples) {
      const raw = `[Task](most-important/${example.name})`
      const done = !example.yaml.complete
      await setMostImportantComplete(storage.timeDir, file, raw, done)
      const changed = Document.fromMarkdown(await readFile(path.join(dir, example.name), 'utf8'))
      assert({
        given: `an existing ${example.name} document`,
        should: 'change only completion, retaining blank and populated headers, custom metadata, and notes',
        actual: { yaml: changed.yaml, notes: changed.markdown.includes('Keep these working notes.') },
        expected: { yaml: { ...example.yaml, complete: done }, notes: true },
      })
    }
    const saved = await saveMostImportant(storage, DAY, DRAFT, crypto.randomUUID())
    assert({
      given: 'old blank and titled names, a gap in numbering, and a timestamp name',
      should: 'read all records and continue after the highest daily ordinal',
      actual: { found: found.length, count: saved.count, name: path.basename(saved.file).startsWith('MI8_') },
      expected: { found: 3, count: 8, name: true },
    })
  })
})

test('a lost receipt after publication recovers once and a completed save never recreates a removed day item', async () => {
  await fixture(async (storage, _root, file) => {
    const request = crypto.randomUUID()
    const saved = await saveMostImportant(storage, DAY, DRAFT, request)
    const receiptDir = path.join(storage.stateDir, 'most-important', DAY.ymd)
    const receiptFile = path.join(receiptDir, (await readdir(receiptDir))[0])
    const receipt = JSON.parse(await readFile(receiptFile, 'utf8'))
    await writeFile(receiptFile, JSON.stringify({ ...receipt, linked: false }))
    const ended = DayDocument.fromMarkdown(await readFile(file, 'utf8'))
    ended.yaml['ended'] = '18:00'
    await writeFile(file, ended.toMarkdown())
    const recovered = await saveMostImportant(storage, DAY, DRAFT, request)
    const miFile = path.join(path.dirname(file), saved.file)
    const edited = (await readFile(miFile, 'utf8')) + '\n## Result\n\nSent and ready for feedback.\n'
    await writeFile(miFile, edited)
    const withoutItem = DayDocument.createFutureDay(DAY).toMarkdown()
    await writeFile(file, withoutItem)
    const again = await saveMostImportant(storage, DAY, DRAFT, request)
    assert({
      given: 'publication before receipt success, then the day ends and the user edits and removes the day row',
      should: 'recover the original save and preserve the later edits and removal on every retry',
      actual: {
        saved,
        recovered,
        again,
        dayUnchanged: (await readFile(file, 'utf8')) === withoutItem,
        taskUnchanged: (await readFile(miFile, 'utf8')) === edited,
        files: (await readdir(path.dirname(miFile))).length,
      },
      expected: { saved, recovered: saved, again: saved, dayUnchanged: true, taskUnchanged: true, files: 1 },
    })
  })
})

test('concurrent MI saves preserve both links and claim distinct daily ordinals', async () => {
  await fixture(async (storage, _root, file) => {
    const saved = await Promise.all([
      saveMostImportant(storage, DAY, DRAFT, crypto.randomUUID()),
      saveMostImportant(storage, DAY, DRAFT, crypto.randomUUID()),
    ])
    const items = DayDocument.fromMarkdown(await readFile(file, 'utf8')).lists.find(
      (list) => list.title === 'Most Important',
    )!.items
    assert({
      given: 'two simultaneous accepts with the same title',
      should: 'allocate distinct files and retain both commitments',
      actual: {
        counts: saved.map((item) => item.count).sort(),
        unique: new Set(saved.map((item) => item.file.toLowerCase())).size,
        rows: items.length,
        documents: (await readDayMostImportant(DAY, storage.timeDir)).length,
      },
      expected: { counts: [1, 2], unique: 2, rows: 2, documents: 2 },
    })
  })
})

test('an interrupted MI save is hidden from context and a retry repairs its day link', async () => {
  await fixture(async (storage, _root, file) => {
    await mkdir(path.dirname(file), { recursive: true })
    const before = DayDocument.createFutureDay(DAY).toMarkdown()
    await writeFile(file, before)
    const request = crypto.randomUUID()
    try {
      await saveMostImportant(
        {
          ...storage,
          write: async () => {
            throw new Error('disk unavailable')
          },
        },
        DAY,
        DRAFT,
        request,
      )
    } catch {
      /* The response reports failure; the same save can be retried. */
    }
    const pending = await readDayMostImportant(DAY, storage.timeDir)
    const unchanged = await readFile(file, 'utf8')
    const other = await saveMostImportant(
      storage,
      DAY,
      { ...DRAFT, summary: 'Review the Widget brief' },
      crypto.randomUUID(),
    )
    const saved = await saveMostImportant(storage, DAY, DRAFT, request)
    assert({
      given: 'the draft prepared privately but the day write failed',
      should: 'keep unfinished work outside the notebook and publish the same file exactly once on retry',
      actual: {
        pending: pending.length,
        unchanged: unchanged === before,
        count: saved.count,
        otherCount: other.count,
        files: (await readdir(path.join(path.dirname(file), 'most-important'))).length,
        accepted: (await readDayMostImportant(DAY, storage.timeDir)).length,
      },
      expected: { pending: 0, unchanged: true, count: 1, otherCount: 2, files: 2, accepted: 2 },
    })
  })
})

test('an external filename collision preserves that file and rolls back only the save’s day link', async () => {
  await fixture(async (storage, _root, file) => {
    const folder = path.join(path.dirname(file), 'most-important')
    await mkdir(folder, { recursive: true })
    const before = DayDocument.createFutureDay(DAY).toMarkdown()
    await writeFile(file, before)
    const collision = path.join(folder, 'MI1_Review-Atlas.md')
    let refused = false
    try {
      await saveMostImportant(
        {
          ...storage,
          write: async (target, content) => {
            await writeFile(target, content)
            await writeFile(collision, 'Another writer’s task.\n')
          },
        },
        DAY,
        { ...DRAFT, summary: 'Review Atlas' },
        crypto.randomUUID(),
      )
    } catch {
      refused = true
    }
    assert({
      given: 'an external writer claiming the reserved name between planning and publication',
      should: 'never overwrite their content or keep a misleading day link',
      actual: { refused, task: await readFile(collision, 'utf8'), day: await readFile(file, 'utf8') },
      expected: { refused: true, task: 'Another writer’s task.\n', day: before },
    })
  })
})

test('MI completion changes its metadata, preserves working notes, and supports rollback and reopening', async () => {
  await fixture(async (storage, _root, file) => {
    const saved = await saveMostImportant(
      storage,
      DAY,
      { ...DRAFT, dueBy: '15:00', body: DRAFT.body + '\n## Decision\n\nKeep the draft provisional.\n' },
      crypto.randomUUID(),
    )
    const miFile = path.join(path.dirname(file), saved.file)
    const original = await readFile(miFile, 'utf8')
    const raw = DayDocument.fromMarkdown(await readFile(file, 'utf8')).lists.find(
      (list) => list.title === 'Most Important',
    )!.items[0]
    const rollback = await setMostImportantComplete(storage.timeDir, file, raw, true)
    const done = Document.fromMarkdown(await readFile(miFile, 'utf8'))
    await rollback()
    const reverted = await readFile(miFile, 'utf8')
    const reference = `MI/1 -> [Review the proposal][priority]\n\n[priority]: ${saved.file}`
    await setMostImportantComplete(storage.timeDir, file, reference.split('\n')[0], true, reference)
    const referenceDone = Document.fromMarkdown(await readFile(miFile, 'utf8')).yaml['complete']
    await setMostImportantComplete(storage.timeDir, file, raw, false)
    const reopened = Document.fromMarkdown(await readFile(miFile, 'utf8'))
    assert({
      given: 'a checked MI, a failed day write, and a later reopen',
      should: 'keep completion consistent without rewriting the commitment or its notes',
      actual: {
        done: done.yaml['complete'],
        rollback: reverted === original,
        reference: referenceDone,
        reopened: reopened.yaml['complete'],
        due: reopened.markdown.includes('Due: 15:00'),
        notes: reopened.markdown.includes('## Decision\n\nKeep the draft provisional.'),
      },
      expected: { done: true, rollback: true, reference: true, reopened: false, due: true, notes: true },
    })
  })
})

test('ended days and MI links outside the notebook cannot be mutated', async () => {
  await fixture(async (storage, root, file) => {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, '---\nended: 18:00\n---\n\n# 2030-06-17\n')
    let ended = false
    try {
      await saveMostImportant(storage, DAY, DRAFT, crypto.randomUUID())
    } catch {
      ended = true
    }
    const outside = path.join(root, 'outside', 'most-important')
    await mkdir(outside, { recursive: true })
    await writeFile(path.join(outside, 'MI1.md'), '---\ncomplete: false\n---\n\nPrivate mock record.\n')
    const dir = path.join(storage.timeDir, dayDir(DAY), 'most-important')
    await symlink(outside, dir)
    let refused = false
    try {
      await setMostImportantComplete(storage.timeDir, file, '[Task](most-important/MI1.md)', true)
    } catch {
      refused = true
    }
    assert({
      given: 'an ended day and a symlink out of the notebook',
      should: 'refuse both writes',
      actual: {
        ended,
        refused,
        unchanged: (await readFile(path.join(outside, 'MI1.md'), 'utf8')).includes('complete: false'),
      },
      expected: { ended: true, refused: true, unchanged: true },
    })
  })
})
