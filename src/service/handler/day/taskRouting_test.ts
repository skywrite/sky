import { randomUUID } from 'node:crypto'
import * as path from 'node:path'
import { withDayNotebook } from '#commands/all/day/_testNotebook.ts'
import { readOptional } from '#lib/outbox/files.ts'
import { exists, outputFile, readTextFile } from '#shared/fs/mod.ts'
import DayDocument from '#shared/models/Day/mod.ts'
import { dayFile } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate, Week } from '#universal/dates/nbdt/mod.ts'
import { createWeekRoutes } from '../week/mod.ts'
import { createDayRoutes, type DayView } from './mod.ts'

const SOURCE = new PlainDate('2031-03-15')
const TODAY = new PlainDate('2031-03-16')
const LATER = new PlainDate('2031-03-17')
const CONTENT = `---
started: 08:00
ended:
---

## Professional Todos

- Review [Atlas][brief]
  Keep [notes](notes.md).
  - Nested detail

## Personal Commitments

- 25:30 > Call Jane Doe

## Reminders

- Water the plants

[brief]: https://example.com/atlas
`

const post = (app: ReturnType<typeof createDayRoutes>, day: PlainDate, route: string, body: unknown) =>
  app.request(`/${day.ymd}/item/${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

for (const precreated of [false, true])
  test(`web bulk moves use schedule files beyond Sunday (precreated: ${precreated})`, async () => {
    await withDayNotebook(async ({ context }) => {
      const { config } = context
      const source = path.join(config.DIR_TIME, dayFile(SOURCE))
      const target = path.join(config.DIR_TIME, dayFile(LATER))
      await outputFile(source, CONTENT)
      const future = DayDocument.createFutureDay(LATER).addTodoItem('Existing future plan').toMarkdown()
      if (precreated) await outputFile(target, future)
      const app = createDayRoutes({
        timeDir: config.DIR_TIME,
        markdownBaseDir: config.DIR_BASE,
        today: () => TODAY,
        ownerNames: [],
      })
      const view = (await (await app.request(`/${SOURCE.ymd}`)).json()) as DayView
      const items = [...view.record.todos, ...view.record.commitments, ...view.record.reminders].map(
        ({ list, raw, revision }) => ({ list, raw, revision }),
      )
      const input = { items, date: LATER.ymd, requestId: randomUUID() }
      const response = await post(app, SOURCE, 'organize/move', input)
      const result = (await response.json()) as { undo: string; href: string }
      const professional = await readOptional(config.FILE_SCHEDULE_PROFESSIONAL)
      const personal = await readOptional(config.FILE_SCHEDULE_PERSONAL)
      assert({
        given: 'a mixed selection moved into next week',
        should: 'use category schedules, keep notes and types, and link to the week where the tasks are visible',
        actual: {
          status: response.status,
          target: await readOptional(target),
          href: result.href,
          note: professional?.includes('  - Nested detail'),
          link: professional?.includes('[Atlas](https://example.com/atlas)'),
          commitment: personal?.includes('25:30 > Call Jane Doe'),
          reminder: personal?.includes('Water the plants <!-- sky-list: Reminders -->'),
        },
        expected: {
          status: 200,
          target: precreated ? future : undefined,
          href: `/week/${Week.of(LATER)}`,
          note: true,
          link: true,
          commitment: true,
          reminder: true,
        },
      })
      await post(app, SOURCE, 'organize/move', input)
      assert({
        given: 'a retry of the same move',
        should: 'not duplicate scheduled items',
        actual: await readTextFile(config.FILE_SCHEDULE_PERSONAL),
        expected: personal,
      })
      await outputFile(config.FILE_SCHEDULE_PROFESSIONAL, professional + '\nA later note.\n')
      const undo = await post(app, SOURCE, 'organize/undo', { id: result.undo })
      assert({
        given: 'Undo after an unrelated edit to one schedule',
        should: 'restore all source blocks, preserve the later edit, and remove only untouched newly created files',
        actual: {
          status: undo.status,
          source: await readTextFile(source),
          note: (await readTextFile(config.FILE_SCHEDULE_PROFESSIONAL)).includes('A later note.'),
          personal: await exists(config.FILE_SCHEDULE_PERSONAL),
        },
        expected: { status: 200, source: CONTENT, note: true, personal: false },
      })
    })
  })

test('web edits can change task type and schedule in one save, with exact Undo', async () => {
  await withDayNotebook(async ({ context }) => {
    const { config } = context
    const file = path.join(config.DIR_TIME, dayFile(SOURCE))
    await outputFile(file, CONTENT)
    const app = createDayRoutes({
      timeDir: config.DIR_TIME,
      markdownBaseDir: config.DIR_BASE,
      today: () => TODAY,
      ownerNames: [],
    })
    const view = (await (await app.request(`/${SOURCE.ymd}`)).json()) as DayView
    const item = view.record.todos[0]
    const response = await post(app, SOURCE, 'edit', {
      list: item.list,
      raw: item.raw,
      revision: item.revision,
      text: 'Call about Atlas',
      kind: 'commitments',
      category: 'Personal',
      time: '09:30',
      date: LATER.ymd,
      requestId: randomUUID(),
    })
    const result = (await response.json()) as { undo: string }
    assert({
      given: 'a date and type edit to next week',
      should: 'schedule the edited commitment with its notes and create no day',
      actual: [
        response.status,
        (await readTextFile(config.FILE_SCHEDULE_PERSONAL)).includes('09:30 > Call about Atlas'),
        await exists(path.join(config.DIR_TIME, dayFile(LATER))),
      ],
      expected: [200, true, false],
    })
    await post(app, SOURCE, 'organize/undo', { id: result.undo })
    assert({
      given: 'Undo of the combined edit',
      should: 'restore the exact original source',
      actual: await readTextFile(file),
      expected: CONTENT,
    })
  })
})

test('web adds and Next pulls prepare this-week days and schedule later dates with Undo', async () => {
  await withDayNotebook(async ({ context }) => {
    const { config } = context
    const app = createDayRoutes({
      timeDir: config.DIR_TIME,
      markdownBaseDir: config.DIR_BASE,
      today: () => TODAY,
      ownerNames: [],
    })
    const add = await post(app, TODAY, 'add', {
      kind: 'todos',
      category: 'Professional',
      text: 'Review Atlas',
      requestId: randomUUID(),
    })
    const current = DayDocument.fromMarkdown(await readTextFile(path.join(config.DIR_TIME, dayFile(TODAY))))
    assert({
      given: 'an inline add on a missing current-week day',
      should: 'create its unstarted file',
      actual: [add.status, current.started, current.lists.find((list) => list.title === 'Professional Todos')?.items],
      expected: [200, undefined, ['Review Atlas']],
    })
    const scheduled = await post(app, LATER, 'add', {
      kind: 'reminders',
      text: 'Water the plants',
      requestId: randomUUID(),
    })
    const added = (await scheduled.json()) as { undo: string; href: string }
    assert({
      given: 'an inline reminder add on a missing later date',
      should: 'schedule it without a day file',
      actual: [scheduled.status, added.href, await exists(path.join(config.DIR_TIME, dayFile(LATER)))],
      expected: [200, `/week/${Week.of(LATER)}`, false],
    })
    await post(app, LATER, 'undo', { id: added.undo })
    assert({
      given: 'Undo of the future add',
      should: 'remove only the created schedule file',
      actual: await exists(config.FILE_SCHEDULE_PERSONAL),
      expected: false,
    })
    const next = path.join(config.DIR_TIME, 'next-professional.md')
    const before = '# Next\n\n## Next\n\n- Review the outline\n'
    await outputFile(next, before)
    const candidates = (await (await app.request(`/${LATER.ymd}/item/next`)).json()) as { items: { id: string }[] }
    const pull = await post(app, LATER, 'pull', {
      kind: 'todos',
      ids: [candidates.items[0].id],
      requestId: randomUUID(),
    })
    const pulled = (await pull.json()) as { undo: string }
    assert({
      given: 'a Next item pulled onto next week',
      should: 'land in the schedule and leave the Next list',
      actual: [
        pull.status,
        (await readTextFile(config.FILE_SCHEDULE_PROFESSIONAL)).includes('Review the outline'),
        (await readTextFile(next)).includes('Review the outline'),
      ],
      expected: [200, true, false],
    })
    await post(app, LATER, 'undo', { id: pulled.undo })
    assert({
      given: 'Undo of a scheduled Next pull',
      should: 'restore the original Next file',
      actual: await readTextFile(next),
      expected: before,
    })
  })
})

test('a failed web move rolls back both category schedules and preserves source items', async () => {
  await withDayNotebook(async ({ context }) => {
    const { config } = context
    const source = path.join(config.DIR_TIME, dayFile(SOURCE))
    await outputFile(source, CONTENT)
    const app = createDayRoutes({
      timeDir: config.DIR_TIME,
      markdownBaseDir: config.DIR_BASE,
      today: () => TODAY,
      ownerNames: [],
      writePlanning: async (file, content) => {
        if (file === source) throw new Error('Simulated source write failure')
        await outputFile(file, content)
      },
    })
    const view = (await (await app.request(`/${SOURCE.ymd}`)).json()) as DayView
    const items = [...view.record.todos, ...view.record.reminders].map(({ list, raw, revision }) => ({
      list,
      raw,
      revision,
    }))
    const result = await post(app, SOURCE, 'organize/move', { items, date: LATER.ymd, requestId: randomUUID() })
    assert({
      given: 'a source failure after both schedules were saved',
      should: 'roll back the scheduled copies and leave the source intact',
      actual: [
        result.status,
        await readTextFile(source),
        await exists(config.FILE_SCHEDULE_PERSONAL),
        await exists(config.FILE_SCHEDULE_PROFESSIONAL),
      ],
      expected: [500, CONTENT, false, false],
    })
  })
})

test('the week-page date picker follows the current week, regardless of the week being viewed', async () => {
  await withDayNotebook(async ({ context }) => {
    const { config } = context
    const app = createWeekRoutes({
      timeDir: config.DIR_TIME,
      markdownBaseDir: config.DIR_BASE,
      now: () => context.notebookNow,
    })
    const send = (date: PlainDate) =>
      app.request(`/${Week.of(LATER)}/queue`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ day: date.ymd, category: 'Professional', text: `Plan for ${date.ymd}` }),
      })
    await send(TODAY)
    const future = DayDocument.createFutureDay(LATER).toMarkdown()
    await outputFile(path.join(config.DIR_TIME, dayFile(LATER)), future)
    const result = await send(LATER)
    assert({
      given: 'current-week and next-week date picks while viewing next week',
      should: 'create the first day and schedule the second despite its existing file',
      actual: [
        result.status,
        await exists(path.join(config.DIR_TIME, dayFile(TODAY))),
        await readTextFile(path.join(config.DIR_TIME, dayFile(LATER))),
        (await readTextFile(config.FILE_SCHEDULE_PROFESSIONAL)).includes(`Plan for ${LATER.ymd}`),
      ],
      expected: [200, true, future, true],
    })
  })
})
