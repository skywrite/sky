import { mkdtemp, rm } from 'node:fs/promises'
import * as path from 'node:path'
import { exists, outputFile, readTextFile } from '#shared/fs/mod.ts'
import TrackingDocument from '#shared/models/Tracking/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { readTrackingCsv, weeklyMonday } from './csv.ts'
import { executeTrackingMigration, planTrackingMigration } from './migrate.ts'
import { appendRecord, recordFilePath } from './records.ts'

test('tracking migration preserves values, dates, multiplicity, schema changes and originals', async () => {
  const root = await mkdtemp('/tmp/sky-track-migrate-')
  const put = (file: string, contents: string) => outputFile(path.join(root, file), contents)
  const def = TrackingDocument.create({
    name: 'hydration',
    storage: 'weekly',
    columns: [
      { name: 'time', type: 'time' },
      { name: 'amount', type: 'number', unit: 'oz' },
      { name: 'notes', type: 'text' },
    ],
  })
  const source = 'time/2030/W53/_tracking/health/hydration.csv'
  const contents = '"day", "amount", "notes"\nM, 8, "first, second"\nT, 9\nW, 10\nW, 10\nSu, -, "kept"\n'
  try {
    await put('tracking/active/hydration.md', def.toMarkdown())
    await put(source, contents)
    await put('time/2031/01-W02/_tracking/health/hydration.csv', 'day,time,amount,notes\nM,25:30,12,"said ""yes"""\n')
    await put('time/2030/W53/_tracking/_journal.md', 'Keep this journal.\n')
    await put('data/tracking/2031/hydration.csv', 'date,time,amount (oz),notes\n2031-01-01,,10,\n')
    await put('data/tracking/2031/length.csv', 'date,inches\n2031-01-01,7\n')
    const plan = await planTrackingMigration(root)
    assert({
      given: 'weekly data overlapping an existing annual row',
      should: 'match one occurrence and retain every other observation',
      actual: [plan.sourceRows, plan.addedRows, plan.matchedRows],
      expected: [6, 5, 1],
    })
    assert({
      given: 'a dry run',
      should: 'leave source bytes unchanged',
      actual: await readTextFile(path.join(root, source)),
      expected: contents,
    })
    const backup = await executeTrackingMigration(plan)
    assert({
      given: 'an executed migration',
      should: 'back up the original source exactly',
      actual: await readTextFile(path.join(backup!, source)),
      expected: contents,
    })
    assert({
      given: 'verified annual records',
      should: 'retire weekly CSVs',
      actual: await exists(path.join(root, source)),
      expected: false,
    })
    assert({
      given: 'a non-CSV weekly file',
      should: 'keep it in place',
      actual: await readTextFile(path.join(root, 'time/2030/W53/_tracking/_journal.md')),
      expected: 'Keep this journal.\n',
    })
    const annual = readTrackingCsv(await readTextFile(path.join(root, 'data/tracking/2031/hydration.csv')))
    assert({
      given: 'two identical same-day observations',
      should: 'preserve both and the extended time',
      actual: annual.rows,
      expected: [
        ['2031-01-01', '', '10', ''],
        ['2031-01-01', '', '10', ''],
        ['2031-01-05', '', '-', 'kept'],
        ['2031-01-06', '25:30', '12', 'said "yes"'],
      ],
    })
    const migrated = TrackingDocument.fromMarkdown(await readTextFile(path.join(root, 'tracking/active/hydration.md')))
    const day = new PlainDate('2031-01-07')
    const target = recordFilePath(
      { timeDir: path.join(root, 'time'), dataTrackingDir: path.join(root, 'data/tracking') },
      migrated,
      day,
    )
    await appendRecord(target, migrated, day, { amount: '14' })
    assert({
      given: 'capture after migration',
      should: 'append with the migrated column order',
      actual: readTrackingCsv(await readTextFile(target)).rows.at(-1),
      expected: ['2031-01-07', '', '14'],
    })
    assert({
      given: 'a completed migration',
      should: 'have no changes on rerun',
      actual: (await planTrackingMigration(root)).changes.length,
      expected: 0,
    })
    assert({
      given: 'an unrelated annual metric',
      should: 'keep its bytes',
      actual: await readTextFile(path.join(root, 'data/tracking/2031/length.csv')),
      expected: 'date,inches\n2031-01-01,7\n',
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('tracking migration refuses stale plans, ambiguous slugs, and inexact repairs', async () => {
  const root = await mkdtemp('/tmp/sky-track-refuse-')
  const file = path.join(root, 'time/2032/W10/_tracking/health/hydration.csv')
  try {
    await outputFile(file, 'day,amount\nM,8\n')
    const plan = await planTrackingMigration(root)
    await outputFile(file, 'day,amount\nM,9\n')
    let refused = false
    try {
      await executeTrackingMigration(plan)
    } catch {
      refused = true
    }
    assert({
      given: 'a source edited after planning',
      should: 'refuse execution before any output exists',
      actual: [refused, await exists(path.join(root, 'data'))],
      expected: [true, false],
    })
    refused = false
    try {
      await planTrackingMigration(root, [{ path: path.relative(root, file), before: 'M,8', after: 'M,7' }])
    } catch {
      refused = true
    }
    assert({
      given: 'a repair whose exact original does not match',
      should: 'refuse to guess',
      actual: refused,
      expected: true,
    })
    const annual = path.join(root, 'data/tracking/2032/hydration.csv')
    await outputFile(annual, '"date", "amount"\n"2032-03-01", "9"\n')
    const covered = await planTrackingMigration(root)
    await outputFile(annual, '"date", "amount"\n')
    refused = false
    try {
      await executeTrackingMigration(covered)
    } catch {
      refused = true
    }
    assert({
      given: 'an annual target edited after it covered an identical source row',
      should: 'refuse retirement and preserve the weekly source',
      actual: [refused, await exists(file)],
      expected: [true, true],
    })
    await outputFile(path.join(root, 'time/2032/W10/_tracking/other/hydration.csv'), 'day,amount\nT,8\n')
    refused = false
    try {
      await planTrackingMigration(root)
    } catch {
      refused = true
    }
    assert({
      given: 'one slug in two categories',
      should: 'refuse a target collision',
      actual: refused,
      expected: true,
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('tracking CSV preserves overflowing fields and repairs only missing terminal quotes', () => {
  const table = readTrackingCsv(
    'day,time,notes\nM,25:30,"unfinished\nT,1:00,"a,b",extra\n',
    new PlainDate('2032-03-01'),
  )
  assert({
    given: 'an unfinished quote and an undeclared field',
    should: 'retain both with explicit warnings',
    actual: [table.header, table.rows, table.warnings.length],
    expected: [
      ['date', 'time', 'notes', 'extra_1'],
      [
        ['2032-03-01', '25:30', 'unfinished'],
        ['2032-03-02', '1:00', 'a,b', 'extra'],
      ],
      2,
    ],
  })
  assert({
    given: 'a clipped legacy week at New Year',
    should: 'resolve its true Monday',
    actual: weeklyMonday('2033/01/01-02/_tracking/health/hydration.csv').ymd,
    expected: '2032-12-27',
  })
})
