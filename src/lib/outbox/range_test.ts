import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { assert, test } from '#test'
import { dayRange, inRange, ScanRangeSchema } from './range.ts'
import { OutboxStore } from './store.ts'

test('An Outbox range keeps both endpoint minutes and validates calendar dates without UTC shifts', () => {
  const range = { start: '2025-03-08T23:30', end: '2025-03-09T03:30' }
  assert({
    given: 'a range crossing midnight and a clock-change date',
    should: 'compare the saved wall-clock timestamps and reject invalid or reversed dates',
    actual: [
      ScanRangeSchema.parse(range),
      ['2025-03-08 23:29', '2025-03-08 23:30', '2025-03-09 03:30', '2025-03-09 03:31'].map((time) =>
        inRange(time, range),
      ),
      ScanRangeSchema.safeParse({ start: '2025-02-30T00:00', end: range.end }).success,
      ScanRangeSchema.safeParse({ start: range.end, end: range.start }).success,
    ],
    expected: [range, [false, true, true, false], false, false],
  })
})

test('The selected Outbox range survives a restart and midnight and refuses a stale editor', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-outbox-range-'))
  try {
    const store = new OutboxStore(path.join(root, 'outbox'), path.join(root, 'state'))
    const initial = await store.scanRange('2025-03-15')
    const value = { start: '2025-03-13T08:30', end: '2025-03-15T17:45' }
    await store.saveScanRange(value, initial.revision, '2025-03-15')
    const reopened = new OutboxStore(store.dir, store.stateDir)
    const saved = await reopened.scanRange('2025-03-16')
    let conflict = false
    try {
      await reopened.saveScanRange(dayRange('2025-03-16'), initial.revision, '2025-03-16')
    } catch {
      conflict = true
    }
    assert({
      given: 'a chosen range, another day, and an older editor',
      should: 'keep the exact selected dates and times until an intentional new selection',
      actual: [initial.value, saved.value, conflict, (await reopened.scanRange('2025-03-17')).value],
      expected: [dayRange('2025-03-15'), value, true, value],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
