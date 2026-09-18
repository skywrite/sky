import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import DayDocument from '#shared/models/Day/document/mod.ts'
import { dayFile } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { createDayRoutes, type DayView } from '../../service/handler/day/mod.ts'
import { planWorkstreamDay, resolveWorkstreamDayItems, updateWorkstreamDay } from './day.ts'
import { WorkstreamStore } from './store.ts'
import { ActivitySchema } from './types.ts'

const DAY = '2025-03-15'
const NEXT_DAY = '2025-03-16'

async function fixture(kind: 'action' | 'decision' = 'action') {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-workstream-day-'))
  const store = new WorkstreamStore(path.join(root, 'workstreams'), path.join(root, 'state'), root)
  const workstream = await store.create(
    {
      title: 'Atlas launch',
      activities: [ActivitySchema.parse({ id: 'prepare', title: 'Prepare the launch brief', kind })],
    },
    `${DAY} 09:00`,
  )
  const options = { store, timeDir: path.join(root, 'time'), now: () => `${DAY} 12:00` }
  const file = path.join(options.timeDir, dayFile(new PlainDate(DAY)))
  return { root, store, workstream, options, file }
}

test('Planning and completing a workstream activity preserves one canonical task and daily history', async () => {
  const f = await fixture()
  try {
    const planned = await planWorkstreamDay(f.options, f.workstream.id, 'prepare', DAY, f.workstream.revision)
    await planWorkstreamDay(f.options, f.workstream.id, 'prepare', DAY, f.workstream.revision)
    const doc = DayDocument.fromMarkdown(await readFile(f.file, 'utf8'))
    const raw = doc.lists.flatMap((list) => list.items)[0]
    const item = { text: 'Prepare the launch brief', done: false, raw, link: null }
    await updateWorkstreamDay(f.options, { day: DAY, raw, action: 'done' })
    await updateWorkstreamDay(f.options, { day: DAY, raw, action: 'done' })
    const complete = (await f.store.get(f.workstream.id))!
    const restarted = new WorkstreamStore(f.store.dir, f.store.stateDir, f.root)
    const today = await resolveWorkstreamDayItems(restarted, DAY, DAY, [item])
    await planWorkstreamDay(f.options, complete.id, 'prepare', NEXT_DAY, complete.revision)
    await updateWorkstreamDay(f.options, { day: NEXT_DAY, raw, action: 'reopen' })
    const yesterday = await resolveWorkstreamDayItems(restarted, DAY, NEXT_DAY, [item])
    const next = await resolveWorkstreamDayItems(restarted, NEXT_DAY, NEXT_DAY, [item])
    const endedMarkdown = doc.updateYaml({ started: '08:00', ended: '13h', tz: 'America/Chicago' }).toMarkdown()
    await writeFile(f.file, endedMarkdown)
    const app = createDayRoutes({
      markdownBaseDir: f.root,
      timeDir: f.options.timeDir,
      workstreams: restarted,
      today: () => new PlainDate(DAY),
      ownerNames: [],
    })
    const ended = (await (await app.request(`/${DAY}`)).json()) as DayView
    const before = await restarted.get(f.workstream.id)
    const rejected = await app.request(`/${DAY}/item`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ list: 'Workstream Todos', raw, done: true }),
    })
    assert({
      given: 'an ended current day linked to work that has since reopened on another day',
      should: 'preserve the recorded result and reject edits before touching the canonical work',
      actual: {
        endedAt: ended.record.endedAt,
        done: ended.record.todos[0].done,
        status: rejected.status,
        sameWork: (await restarted.get(f.workstream.id))?.revision === before?.revision,
        sameDay: (await readFile(f.file, 'utf8')) === endedMarkdown,
      },
      expected: { endedAt: `${DAY} 21:00`, done: true, status: 409, sameWork: true, sameDay: true },
    })
    assert({
      given: 'repeated planning/completion, restart, and reopening on another day',
      should: 'retain one task, one completion report and the original day’s completed snapshot',
      actual: {
        rows: doc.lists.flatMap((list) => list.items).length,
        plannedEntries: planned.activities[0].participation.length,
        completionReports: complete.history.filter((entry) => entry.kind === 'day_done').length,
        today: today[0].done,
        yesterday: yesterday[0].done,
        next: next[0].done,
        count: (await restarted.get(f.workstream.id))!.activities.length,
      },
      expected: {
        rows: 1,
        plannedEntries: 1,
        completionReports: 1,
        today: true,
        yesterday: true,
        next: false,
        count: 1,
      },
    })
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

test('Removing a daily reference leaves its work intact and restoring it is idempotent', async () => {
  const f = await fixture()
  try {
    await planWorkstreamDay(f.options, f.workstream.id, 'prepare', DAY, f.workstream.revision)
    const raw = DayDocument.fromMarkdown(await readFile(f.file, 'utf8')).lists.flatMap((list) => list.items)[0]
    const item = { text: 'Prepare the launch brief', done: false, raw, link: null }
    await updateWorkstreamDay(f.options, { day: DAY, raw, action: 'remove' })
    const removed = await resolveWorkstreamDayItems(f.store, DAY, DAY, [item])
    const state = (await f.store.get(f.workstream.id))!.activities[0].state
    await updateWorkstreamDay(f.options, { day: DAY, raw, action: 'restore' })
    await updateWorkstreamDay(f.options, { day: DAY, raw, action: 'restore' })
    assert({
      given: 'a removed day placement and a retried undo',
      should: 'detach and reattach without canceling or duplicating work',
      actual: [
        removed.length,
        state,
        (await resolveWorkstreamDayItems(f.store, DAY, DAY, [item])).length,
        (await f.store.get(f.workstream.id))!.history.filter((entry) => entry.kind === 'day_restore').length,
      ],
      expected: [0, 'ready', 1, 1],
    })
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

test('Repeated planning repairs a failed day projection using the original request revision', async () => {
  const f = await fixture()
  try {
    await writeFile(f.options.timeDir, 'A temporary obstruction.')
    let interrupted = false
    try {
      await planWorkstreamDay(f.options, f.workstream.id, 'prepare', DAY, f.workstream.revision)
    } catch {
      interrupted = true
    }
    await rm(f.options.timeDir)
    const repaired = await planWorkstreamDay(f.options, f.workstream.id, 'prepare', DAY, f.workstream.revision)
    const doc = DayDocument.fromMarkdown(await readFile(f.file, 'utf8'))
    assert({
      given: 'the canonical plan was saved but writing the day failed',
      should: 'repair the projection without duplicate participation or history',
      actual: [
        interrupted,
        repaired.activities[0].participation.length,
        repaired.history.filter((entry) => entry.kind === 'day_planned').length,
        doc.lists.flatMap((list) => list.items).length,
      ],
      expected: [true, 1, 1, 1],
    })
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

test('Decisions need a recorded resolution and missing links remain visible', async () => {
  const f = await fixture('decision')
  try {
    await planWorkstreamDay(f.options, f.workstream.id, 'prepare', DAY, f.workstream.revision)
    const raw = DayDocument.fromMarkdown(await readFile(f.file, 'utf8')).lists.flatMap((list) => list.items)[0]
    let refused = false
    try {
      await updateWorkstreamDay(f.options, { day: DAY, raw, action: 'done' })
    } catch {
      refused = true
    }
    const broken = {
      text: 'Old activity',
      done: false,
      link: null,
      raw: '[Old activity](/workstreams/missing?activity=missing)',
    }
    const visible = await resolveWorkstreamDayItems(f.store, DAY, DAY, [broken])
    assert({
      given: 'a decision checkbox and a broken reference',
      should: 'require judgment and retain the broken day entry',
      actual: [refused, (await f.store.get(f.workstream.id))!.activities[0].state, visible.length],
      expected: [true, 'ready', 1],
    })
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})

test('The existing day routes write through linked rows and leave ordinary tasks unchanged', async () => {
  const f = await fixture()
  try {
    await planWorkstreamDay(f.options, f.workstream.id, 'prepare', DAY, f.workstream.revision)
    const app = createDayRoutes({
      markdownBaseDir: f.root,
      timeDir: f.options.timeDir,
      workstreams: f.store,
      today: () => new PlainDate(DAY),
      ownerNames: [],
    })
    const initial = (await (await app.request(`/${DAY}`)).json()) as DayView
    const entry = initial.record.todos[0]
    const checked = await app.request(`/${DAY}/item`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ list: entry.list, raw: entry.raw, done: true }),
    })
    const completed = (await checked.json()) as DayView
    const deletion = { list: entry.list, raw: entry.raw }
    const remove = () =>
      app.request(`/${DAY}/item/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(deletion),
      })
    const removed = await remove()
    const removedAgain = await remove()
    const retry = (await removedAgain.json()) as { at: number; view: DayView }
    const restored = await app.request(`/${DAY}/item/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...deletion, at: retry.at }),
    })
    const rejected = await app.request(`/${DAY}/item`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://example.com' },
      body: JSON.stringify({ list: entry.list, raw: entry.raw, done: false }),
    })
    assert({
      given: 'a linked row checked through the real day route, followed by a cross-origin request',
      should: 'return canonical progress and reject the cross-origin write',
      actual: [
        checked.status,
        completed.record.todos[0].done,
        (await f.store.get(f.workstream.id))!.activities[0].state,
        rejected.status,
        removed.status,
        removedAgain.status,
        retry.view.record.todos.length,
        restored.status,
      ],
      expected: [200, true, 'done', 403, 200, 200, 0, 200],
    })
  } finally {
    await rm(f.root, { recursive: true, force: true })
  }
})
