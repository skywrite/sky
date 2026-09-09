import { readFile, symlink } from 'node:fs/promises'
import * as path from 'node:path'
import { appendRecord, recordFilePath } from '#commands/all/track/lib/records.ts'
import { writeJson } from '#lib/jobs/files.ts'
import TrackingDocument from '#shared/models/Tracking/mod.ts'
import { ALL_LAYOUTS } from '#shared/nbfs/layout/registry.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { fingerprint, readTrackingFile } from './files.ts'
import { sleepInput, TRACKING_TODAY, trackingFixture } from './testHelpers.ts'
import { TrackingError } from './types.ts'

const status = (promise: Promise<unknown>) =>
  promise.then(
    () => 200,
    (error: unknown) => (error instanceof TrackingError ? error.status : 400),
  )
const id = () => crypto.randomUUID()

test('All time reads the entire recorded history across annual and legacy storage', async () => {
  const f = await trackingFixture()
  try {
    await f.store.create(id(), sleepInput)
    await f.put(
      'data/tracking/1901/sleep.csv',
      'date, duration (hr), notes\n1901-02-03, 8, "An older observation"\n1901-02-03, 8, "A separate observation"\n',
    )
    await f.put('data/tracking/2030/sleep.csv', 'date, duration (hr)\n2030-06-18, 7\n')
    await f.put('data/tracking/2025/sleep.csv', '')
    const week = ALL_LAYOUTS[2].weekDir(new PlainDate('2024-12-30'))
    await f.put(path.join('time', week, '_tracking/Health/sleep.csv'), 'day, duration (hr)\nM, 6\nW, 9\n')
    const report = await f.store.report(undefined, undefined, 'sleep', 'all')
    assert({
      given: 'rows older than the definition, duplicate observations, and a legacy week crossing New Year',
      should: 'return all recorded dates while honoring even an empty annual file over legacy rows',
      actual: [
        report.start,
        report.end,
        report.metrics[0].entries.map((entry) => [entry.date, entry.values.duration]),
        report.errors,
      ],
      expected: [
        '1901-02-03',
        TRACKING_TODAY,
        [
          ['1901-02-03', '8'],
          ['1901-02-03', '8'],
          ['2024-12-30', '6'],
          [TRACKING_TODAY, '7'],
        ],
        [],
      ],
    })
    assert({
      given: 'the normal 30-day view after an All time request',
      should: 'still filter to its own range',
      actual: (await f.store.report()).metrics[0].entries.map((entry) => entry.date),
      expected: [TRACKING_TODAY],
    })
    await f.store.create(id(), {
      ...sleepInput,
      title: 'Running',
      columns: [{ name: 'distance', type: 'number', unit: 'km', aggregate: 'sum' }],
    })
    await f.put('data/tracking/1899/running.csv', 'date, distance (km)\n1899-06-01, 5\n')
    let tracker = (await f.store.report()).metrics.find((metric) => metric.tracker.name === 'running')!.tracker
    await f.store.setStatus('running', id(), tracker.revision, 'archived')
    const overview = await f.store.report(undefined, undefined, undefined, 'all')
    tracker = overview.metrics.find((metric) => metric.tracker.name === 'running')!.tracker
    assert({
      given: 'archived and active trackers with different history lengths',
      should: 'include archived history in All time and derive bounds for the requested trackers',
      actual: [overview.start, tracker.status, (await f.store.report(undefined, undefined, 'sleep', 'all')).start],
      expected: ['1899-06-01', 'archived', '1901-02-03'],
    })
  } finally {
    await f.dispose()
  }
})

test('All time has a usable empty state and discovers every supported week layout', async () => {
  const f = await trackingFixture()
  try {
    const empty = await f.store.report(undefined, undefined, undefined, 'all')
    assert({
      given: 'a notebook without trackers or record directories',
      should: 'return an empty report anchored to today',
      actual: [empty.start, empty.end, empty.metrics, empty.errors],
      expected: [TRACKING_TODAY, TRACKING_TODAY, [], []],
    })
    for (const [index, layout] of ALL_LAYOUTS.entries()) {
      const title = `Sample ${index + 1}`
      const { name } = await f.store.create(id(), { ...sleepInput, title })
      const week = layout.weekDir(new PlainDate('2028-06-12'))
      await f.put(path.join('time', week, '_tracking/Health', `${name}.csv`), 'day, duration (hr)\nM, 7.5\n')
    }
    const report = await f.store.report(undefined, undefined, undefined, 'all')
    assert({
      given: 'existing files in current, month-labeled, and legacy weeks',
      should: 'discover each history without depending on the configured layout or start metadata',
      actual: [report.start, report.metrics.map((metric) => metric.entries.length), report.errors],
      expected: ['2028-06-12', [1, 1, 1], []],
    })
  } finally {
    await f.dispose()
  }
})

test('tracking preserves duplicate observations, retries once, and undoes exact file changes', async () => {
  const f = await trackingFixture()
  try {
    await f.store.create(id(), sleepInput)
    const tracker = (await f.store.report()).metrics[0].tracker
    const input = {
      operationId: id(),
      revision: tracker.revision,
      date: TRACKING_TODAY,
      values: { duration: '7h 30m', notes: 'Quiet night, felt "rested"' },
    }
    const first = await f.store.saveEntry(tracker.name, input)
    assert({
      given: 'the same network request retried',
      should: 'return its original receipt without appending twice',
      actual: await f.store.saveEntry(tracker.name, input),
      expected: first,
    })
    const csv = path.join(f.dirs.dataTrackingDir, '2030/sleep.csv')
    const one = await readFile(csv, 'utf8')
    await f.store.saveEntry(tracker.name, { ...input, operationId: id() })
    const two = await readFile(csv, 'utf8')
    let entries = (await f.store.report()).metrics[0].entries
    assert({
      given: 'two intentional identical observations',
      should: 'keep both with distinct edit tokens and stable display identities',
      actual: [
        entries.length,
        entries[0].id !== entries[1].id,
        entries[0].key !== entries[1].key,
        entries[0].values.duration,
      ],
      expected: [2, true, true, '7.5'],
    })
    const deleted = await f.store.deleteEntry('sleep', id(), entries[1])
    assert({
      given: 'deleting only the second duplicate',
      should: 'retain the first byte for byte',
      actual: await readFile(csv, 'utf8'),
      expected: one,
    })
    await f.store.undo(deleted.undoId)
    assert({
      given: 'undoing that deletion',
      should: 'restore both original rows exactly',
      actual: await readFile(csv, 'utf8'),
      expected: two,
    })
    entries = (await f.store.report()).metrics[0].entries
    const changed = await f.store.saveEntry('sleep', {
      ...input,
      operationId: id(),
      entry: entries[1],
      values: { duration: '8', notes: 'Corrected' },
    })
    assert({
      given: 'a correction',
      should: 'replace only the selected observation',
      actual: (await f.store.report()).metrics[0].entries.map((e) => e.values.duration),
      expected: ['7.5', '8'],
    })
    await f.store.undo(changed.undoId)
    await f.store.undo(changed.undoId)
    assert({ given: 'an Undo retry', should: 'remain idempotent', actual: await readFile(csv, 'utf8'), expected: two })
    assert({
      given: 'a save token from before the correction',
      should: 'refuse to reuse an undone operation',
      actual: await status(f.store.saveEntry('sleep', { ...input, operationId: changed.undoId })),
      expected: 409,
    })
  } finally {
    await f.dispose()
  }
})

test('external edits and concurrent CLI appends are never overwritten', async () => {
  const f = await trackingFixture()
  try {
    await f.store.create(id(), sleepInput)
    const tracker = (await f.store.report()).metrics[0].tracker
    const input = { operationId: id(), revision: tracker.revision, date: TRACKING_TODAY, values: { duration: '7' } }
    const receipt = await f.store.saveEntry('sleep', input)
    const old = (await f.store.report()).metrics[0].entries[0]
    const doc = TrackingDocument.fromMarkdown(await readFile(path.join(f.root, tracker.path), 'utf8'))
    const file = recordFilePath(f.dirs, doc, new PlainDate(TRACKING_TODAY))
    const writes = await Promise.allSettled([
      ...Array.from({ length: 4 }, (_, at) =>
        appendRecord(file, doc, new PlainDate(TRACKING_TODAY), { duration: String(at + 1) }),
      ),
      f.store.saveEntry('sleep', { ...input, operationId: id(), values: { duration: '8' } }),
    ])
    const webSaved = writes[4].status === 'fulfilled'
    const rows = (await f.store.report()).metrics[0].entries
    assert({
      given: 'simultaneous CLI and browser writes',
      should: 'retain every successful observation and keep existing DOM identities',
      actual: [
        writes.slice(0, 4).every((w) => w.status === 'fulfilled'),
        rows.length,
        rows[0].key === old.key,
        rows[0].id !== old.id,
      ],
      expected: [true, webSaved ? 6 : 5, true, true],
    })
    const before = await readFile(file, 'utf8')
    assert({
      given: 'a stale editor and an old Undo after those writes',
      should: 'return conflicts instead of overwriting new records',
      actual: [
        await status(f.store.saveEntry('sleep', { ...input, operationId: id(), entry: old })),
        await status(f.store.undo(receipt.undoId)),
        await readFile(file, 'utf8'),
      ],
      expected: [409, 409, before],
    })
    await f.put(tracker.path, `${doc.toMarkdown()}\nA note added in the editor.\n`)
    assert({
      given: 'a tracker definition edited in another window',
      should: 'refuse an old setup form',
      actual: await status(f.store.configure('sleep', id(), tracker.revision, sleepInput)),
      expected: 409,
    })
  } finally {
    await f.dispose()
  }
})

test('backdated edits preserve legacy columns and move safely between annual files', async () => {
  const f = await trackingFixture()
  try {
    await f.store.create(id(), sleepInput)
    const tracker = (await f.store.report()).metrics[0].tracker
    const original =
      '\uFEFF"date", "notes", "duration (hr)", "old detail"\r\n2030-06-17, "A, B", 7, "Keep me"\r\n2030-06-17, "Other", 8, "Stay here"'
    const source = await f.put('data/tracking/2030/sleep.csv', original)
    const entry = (await f.store.report()).metrics[0].entries[0]
    const receipt = await f.store.saveEntry('sleep', {
      operationId: id(),
      revision: tracker.revision,
      entry,
      date: '2029-12-31',
      values: { duration: '7h 45m', notes: 'A corrected date' },
    })
    const history = (await f.store.report('2029-12-31', TRACKING_TODAY)).metrics[0].entries
    assert({
      given: 'a cross-year correction with reordered and retired columns',
      should: 'move the selected row, keep every named value, and leave other rows unchanged',
      actual: [
        history.map((e) => [e.date, e.values.duration, e.values['old detail']]),
        (await readFile(source, 'utf8')).endsWith('2030-06-17, "Other", 8, "Stay here"'),
      ],
      expected: [
        [
          ['2029-12-31', '7.75', 'Keep me'],
          ['2030-06-17', '8', 'Stay here'],
        ],
        true,
      ],
    })
    await f.store.undo(receipt.undoId)
    assert({
      given: 'undoing a cross-year move',
      should: 'restore source bytes and remove the newly created destination',
      actual: [
        await readFile(source, 'utf8'),
        await readTrackingFile(path.join(f.root, 'data/tracking/2029/sleep.csv')),
      ],
      expected: [original, null],
    })
    await f.store.configure('sleep', id(), tracker.revision, {
      ...sleepInput,
      columns: [...sleepInput.columns, { name: 'quality', type: 'word' }],
    })
    const updated = (await f.store.report()).metrics[0].tracker
    await f.store.saveEntry('sleep', {
      operationId: id(),
      revision: updated.revision,
      entry,
      date: entry.date,
      values: { duration: '7.5', notes: 'Edited', quality: 'Good' },
    })
    const rows = (await f.store.report()).metrics[0].entries
    assert({
      given: 'adding an answer and editing an old record',
      should: 'extend the header while retaining other historical fields',
      actual: rows.map((e) => [e.values.quality, e.values['old detail']]),
      expected: [
        ['Good', 'Keep me'],
        ['', 'Stay here'],
      ],
    })
    assert({
      given: 'history that depends on its declared unit',
      should: 'refuse a unit change that would reinterpret those values',
      actual: await status(
        f.store.configure('sleep', id(), updated.revision, {
          ...sleepInput,
          columns: [{ name: 'duration', type: 'duration', unit: 'min' }],
        }),
      ),
      expected: 400,
    })
  } finally {
    await f.dispose()
  }
})

test('weekly history keeps day letters and annual files remain authoritative', async () => {
  const f = await trackingFixture()
  try {
    const doc = TrackingDocument.create({
      name: 'sleep',
      ...sleepInput,
      start: new PlainDate(sleepInput.start),
      end: undefined,
      createdOn: TRACKING_TODAY,
    }).updateYaml({ storage: 'weekly' })
    await f.put('tracking/active/sleep.md', doc.toMarkdown())
    const day = new PlainDate('2030-06-17')
    const source = recordFilePath(f.dirs, doc, day)
    await appendRecord(source, doc, day, { duration: '7' })
    const { tracker, entries } = (await f.store.report()).metrics[0]
    const changed = await f.store.saveEntry('sleep', {
      operationId: id(),
      revision: tracker.revision,
      entry: entries[0],
      date: TRACKING_TODAY,
      values: { duration: '8' },
    })
    assert({
      given: 'moving an entry inside its legacy week',
      should: 'keep day-letter storage and read the new calendar date',
      actual: [(await readFile(source, 'utf8')).includes('T, 8'), (await f.store.report()).metrics[0].entries[0].date],
      expected: [true, TRACKING_TODAY],
    })
    await f.store.undo(changed.undoId)
    await f.put('data/tracking/2030/sleep.csv', 'date, duration (hr), notes\n')
    assert({
      given: 'an annual file created by migration',
      should: 'suppress old weekly rows even when the annual file is empty',
      actual: (await f.store.report()).metrics[0].entries.length,
      expected: 0,
    })
    await f.store.saveEntry('sleep', {
      operationId: id(),
      revision: tracker.revision,
      date: TRACKING_TODAY,
      values: { duration: '9' },
    })
    assert({
      given: 'a definition still marked weekly after migration',
      should: 'append to the authoritative annual file',
      actual: (await f.store.report()).metrics[0].entries.map((e) => [e.date, e.values.duration, e.source]),
      expected: [[TRACKING_TODAY, '9', 'data/tracking/2030/sleep.csv']],
    })
  } finally {
    await f.dispose()
  }
})

test('tracker lifecycle and interrupted transactions preserve recoverable history', async () => {
  const f = await trackingFixture()
  try {
    await f.store.create(id(), sleepInput)
    let tracker = (await f.store.report()).metrics[0].tracker
    await f.store.saveEntry('sleep', {
      operationId: id(),
      revision: tracker.revision,
      date: TRACKING_TODAY,
      values: { duration: '7.5' },
    })
    const archived = await f.store.setStatus('sleep', id(), tracker.revision, 'archived')
    let metric = (await f.store.report()).metrics[0]
    assert({
      given: 'an archived tracker',
      should: 'retain history and stop new entries',
      actual: [
        metric.tracker.status,
        metric.tracker.end,
        metric.entries.length,
        await status(
          f.store.saveEntry('sleep', {
            operationId: id(),
            revision: metric.tracker.revision,
            date: TRACKING_TODAY,
            values: { duration: '8' },
          }),
        ),
      ],
      expected: ['archived', TRACKING_TODAY, 1, 400],
    })
    await f.store.undo(archived.undoId)
    tracker = (await f.store.report()).metrics[0].tracker
    const again = await f.store.setStatus('sleep', id(), tracker.revision, 'archived')
    metric = (await f.store.report()).metrics[0]
    await f.store.setStatus('sleep', id(), metric.tracker.revision, 'active')
    assert({
      given: 'restoring a tracker',
      should: 'retain the same slug and records',
      actual: [
        (await f.store.report()).metrics[0].tracker.status,
        (await f.store.report()).metrics[0].entries.length,
        await status(f.store.undo(again.undoId)),
      ],
      expected: ['active', 1, 409],
    })

    const first = 'data/tracking/2029/sleep.csv',
      second = 'data/tracking/2030/sleep.csv'
    const before = await readFile(path.join(f.root, second), 'utf8')
    const after = 'date, duration (hr)\n2029-12-31, 7.5\n'
    const transaction = {
      id: id(),
      name: 'sleep',
      request: fingerprint('fixture request'),
      changes: [
        { file: first, before: null, after },
        { file: second, before, after: 'date, duration (hr)\n' },
      ],
    }
    await f.put(first, after)
    await writeJson(path.join(f.dirs.stateDir, 'pending.json'), transaction)
    const recovered = await f.store.report('2029-12-31', TRACKING_TODAY)
    assert({
      given: 'a process interrupted halfway through a move',
      should: 'complete it before returning history, with one observation and working Undo',
      actual: recovered.metrics[0].entries.map((e) => e.date),
      expected: ['2029-12-31'],
    })
    await f.store.undo(transaction.id)
    assert({
      given: 'undoing the recovered operation',
      should: 'recover the exact original data',
      actual: [await readTrackingFile(path.join(f.root, first)), await readFile(path.join(f.root, second), 'utf8')],
      expected: [null, before],
    })
    await writeJson(path.join(f.dirs.stateDir, 'pending.json'), transaction)
    await f.put(second, `${before}2030-06-18, 9\n`)
    assert({
      given: 'a pending operation whose source was edited independently',
      should: 'surface a conflict and preserve the external edit',
      actual: [
        await status(f.store.report()),
        (await readFile(path.join(f.root, second), 'utf8')).endsWith('2030-06-18, 9\n'),
      ],
      expected: [409, true],
    })
  } finally {
    await f.dispose()
  }
})

test('unreadable definitions are isolated and symlinked data is never edited', async () => {
  const f = await trackingFixture()
  try {
    await f.store.create(id(), sleepInput)
    const tracker = (await f.store.report()).metrics[0].tracker
    await f.put('tracking/active/broken.md', '---\nname: [invalid\n---\n')
    const external = await f.put('untouched.csv', 'date, duration (hr)\n2030-06-18, 6\n')
    await f.put('data/tracking/2030/placeholder.csv', '')
    await symlink(external, path.join(f.root, 'data/tracking/2030/sleep.csv'))
    assert({
      given: 'a symbolic link in the record path',
      should: 'reject writing through it',
      actual: [
        await status(
          f.store.saveEntry('sleep', {
            operationId: id(),
            revision: tracker.revision,
            date: TRACKING_TODAY,
            values: { duration: '8' },
          }),
        ),
        await readFile(external, 'utf8'),
      ],
      expected: [400, 'date, duration (hr)\n2030-06-18, 6\n'],
    })
    assert({
      given: 'invalid and unsafe trackers',
      should: 'report individual errors without failing the entire report',
      actual: (await f.store.report()).errors.map((e) => e.name).sort(),
      expected: ['broken', 'sleep'],
    })
  } finally {
    await f.dispose()
  }
})
