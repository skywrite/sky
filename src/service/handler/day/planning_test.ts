import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { atomicWrite } from '#lib/outbox/files.ts'
import { exists, makeTempDir } from '#shared/fs/mod.ts'
import DayDocument from '#shared/models/Day/document/mod.ts'
import { dayFile } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { createDayRoutes, type DayRoutesOptions, type DayView } from './mod.ts'
import type { DayPlanResult, NextDayItem } from './planningTypes.ts'

const DAY = new PlainDate('2026-01-27')
const EMPTY = `---
started: 08:00
ended:
tz: America/Chicago
---

# 2026-01-27

## Notes

A paragraph to keep.
`
const PROFESSIONAL = `# Professional

## Next

An example, separate from the tasks:

\`\`\`markdown
- Review the draft
\`\`\`

- ~~Review the draft~~
- Review the draft
- Read [Atlas][brief] and [checklist](../projects/Atlas/checklist.md#review)
- [ ] Send the invoice

## Week-Next

- Plan the workshop

[brief]: ../projects/Atlas/brief.md
`
const PERSONAL = '# Personal\n\n## Next\n\n- Water the plants\n'

async function withNotebook(
  run: (fixture: {
    app: ReturnType<typeof createDayRoutes>
    file: string
    professional: string
    personal: string
    root: string
    post: (route: string, body: unknown) => Promise<Response>
    next: () => Promise<NextDayItem[]>
  }) => Promise<void>,
  options: { content?: string; writePlanning?: DayRoutesOptions['writePlanning'] } = {},
) {
  const root = await makeTempDir({ prefix: 'sky-day-planning-' })
  const timeDir = path.join(root, 'time')
  const file = path.join(timeDir, dayFile(DAY))
  await mkdir(path.dirname(file), { recursive: true })
  const professional = path.join(timeDir, 'next-professional.md')
  const personal = path.join(timeDir, 'next-personal.md')
  await Promise.all([
    writeFile(file, options.content ?? EMPTY),
    writeFile(professional, PROFESSIONAL),
    writeFile(personal, PERSONAL),
  ])
  const app = createDayRoutes({
    markdownBaseDir: root,
    timeDir,
    today: () => DAY,
    ownerNames: [],
    writePlanning: options.writePlanning,
  })
  const post = async (route: string, body: unknown) =>
    app.request(`/${DAY.ymd}/item/${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  const next = async () =>
    ((await (await app.request(`/${DAY.ymd}/item/next`)).json()) as { items: NextDayItem[] }).items
  try {
    await run({ app, file, professional, personal, root, post, next })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test(
  { name: 'day planning adds to empty sections, sorts commitments, and undoes without losing later edits' },
  async () => {
    await withNotebook(async ({ post, file }) => {
      const add = async (body: unknown) => (await (await post('add', body)).json()) as DayPlanResult
      const todo = await add({
        kind: 'todos',
        text: 'Review the outline',
        category: 'Personal',
        requestId: randomUUID(),
      })
      const reminder = await add({ kind: 'reminders', text: 'Leave space for a walk', requestId: randomUUID() })
      const commitment = {
        kind: 'commitments',
        text: 'Call Jane Doe',
        category: 'Professional',
        time: '9:30',
        requestId: randomUUID(),
      }
      const timed = await add(commitment)
      const retry = await add(commitment)
      const late = await add({ ...commitment, text: 'Finish the handoff', time: '25:30', requestId: randomUUID() })
      assert({
        given: 'an empty day and repeated submission of one request',
        should: 'create correct lists with one copy, including extended hours',
        actual: {
          todos: todo.view.record.todos.map((item) => [item.text, item.category]),
          reminders: reminder.view.record.reminders.map((item) => item.text),
          commitments: late.view.record.commitments.map((item) => [item.text, item.time]),
          retried: retry.undo === timed.undo,
          prose: (await readFile(file, 'utf8')).includes('A paragraph to keep.'),
        },
        expected: {
          todos: [['Review the outline', 'Personal']],
          reminders: ['Leave space for a walk'],
          commitments: [
            ['Call Jane Doe', '09:30'],
            ['Finish the handoff', '25:30'],
          ],
          retried: true,
          prose: true,
        },
      })
      await writeFile(file, (await readFile(file, 'utf8')) + '\nA later note.\n')
      const undone = (await (await post('undo', { id: todo.undo })).json()) as DayView
      assert({
        given: 'Undo after other additions and a prose edit',
        should: 'remove only the requested addition',
        actual: [
          undone.record.todos.length,
          undone.record.commitments.length,
          undone.record.reminders.length,
          (await readFile(file, 'utf8')).includes('A later note.'),
        ],
        expected: [0, 2, 1, true],
      })
    })
  },
)

test('timed entries write directly to Complete lists and Undo preserves later changes', async () => {
  await withNotebook(async ({ post, file }) => {
    const entry = {
      kind: 'complete',
      text: 'Activity/Walk: Park loop',
      category: 'Personal',
      time: '9:30',
      requestId: randomUUID(),
    }
    const response = await post('add', entry)
    const added = (await response.json()) as DayPlanResult
    const retry = await post('add', entry)
    const duplicate = await post('add', { ...entry, requestId: randomUUID() })
    await post('add', { ...entry, text: 'Read a chapter', time: '25:30', requestId: randomUUID() })
    await post('add', { ...entry, text: 'Morning walk', time: '08:00', requestId: randomUUID() })
    const professional = (await (
      await post('add', {
        ...entry,
        text: 'Research: Read the brief',
        category: 'Professional',
        time: '10:00',
        requestId: randomUUID(),
      })
    ).json()) as DayPlanResult
    const content = await readFile(file, 'utf8')
    const document = DayDocument.fromMarkdown(content)
    assert({
      given: 'a freeform entry, a retried request, and entries in both categories',
      should: 'save each record once in its Complete list, keeping times and leaving the plan empty',
      actual: {
        statuses: [response.status, retry.status, duplicate.status],
        personal: document.lists.find((list) => list.title === 'Personal Complete')?.items,
        professional: document.lists.find((list) => list.title === 'Professional Complete')?.items,
        done: professional.view.record.done.length,
        plan: professional.view.record.todos.length + professional.view.record.commitments.length,
        message: added.message,
        prose: content.includes('A paragraph to keep.'),
      },
      expected: {
        statuses: [200, 200, 409],
        personal: ['08:00 > Morning walk', '09:30 > Activity/Walk: Park loop', '25:30 > Read a chapter'],
        professional: ['10:00 > Research: Read the brief'],
        done: 4,
        plan: 0,
        message: 'Entry added at 09:30',
        prose: true,
      },
    })
    await writeFile(file, content + '\nA later note.\n')
    const undone = (await (await post('undo', { id: added.undo })).json()) as DayView
    assert({
      given: 'Undo after other entries and an independent note were added',
      should: 'remove only the requested entry',
      actual: {
        entries: undone.record.done.map((item) => item.text).sort(),
        note: (await readFile(file, 'utf8')).includes('A later note.'),
      },
      expected: { entries: ['Morning walk', 'Read a chapter', 'Research: Read the brief'], note: true },
    })
  })
})

test('Complete entries stay on the selected day outside the planning window', async () => {
  await withNotebook(async ({ app, root, file }) => {
    const later = DAY.addDays(14)
    const target = path.join(root, 'time', dayFile(later))
    const response = await app.request(`/${later.ymd}/item/add`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'complete',
        text: 'Activity: A sample entry',
        category: 'Personal',
        time: '10:00',
        requestId: randomUUID(),
      }),
    })
    const added = (await response.json()) as DayPlanResult
    const content = DayDocument.fromMarkdown(await readFile(target, 'utf8'))
    assert({
      given: 'an entry for a missing day beyond the current week',
      should: 'prepare that day with the record, without starting it or scheduling a task',
      actual: {
        status: response.status,
        day: added.view.day.ymd,
        entries: added.view.record.done.map((item) => [item.list, item.raw]),
        started: content.started,
        schedule: await exists(path.join(root, 'time', 'schedule-personal.md')),
        original: await readFile(file, 'utf8'),
      },
      expected: {
        status: 200,
        day: later.ymd,
        entries: [['Personal Complete', '10:00 > Activity: A sample entry']],
        started: undefined,
        schedule: false,
        original: EMPTY,
      },
    })
    const undo = await app.request(`/${later.ymd}/item/undo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: added.undo }),
    })
    assert({
      given: 'Undo of the only entry on a newly created day',
      should: 'remove the untouched new file',
      actual: [undo.status, await exists(target)],
      expected: [200, false],
    })
  })
})

test(
  { name: 'Next moves preserve links, source categories, completed duplicates, and support exact undo' },
  async () => {
    await withNotebook(async ({ next, post, file, professional, personal }) => {
      const entries = await next()
      const selected = entries.filter(
        (item) => ['Review the draft', 'Water the plants'].includes(item.text) || item.text.startsWith('Read Atlas'),
      )
      assert({
        given: 'both Next files with reference links and completed items',
        should: 'offer all unfinished sections and no completed duplicates',
        actual: entries.map((item) => item.text),
        expected: [
          'Review the draft',
          'Read Atlas and checklist',
          'Send the invoice',
          'Plan the workshop',
          'Water the plants',
        ],
      })
      const response = await post('pull', {
        kind: 'todos',
        ids: selected.map((item) => item.id),
        requestId: randomUUID(),
      })
      const moved = (await response.json()) as DayPlanResult
      const content = await readFile(file, 'utf8')
      assert({
        given: 'selected items from both Next files',
        should: 'move once, preserve the completed duplicate and rebase every source link',
        actual: {
          status: response.status,
          categories: moved.view.record.todos.map((item) => item.category).sort(),
          relative:
            content.includes('../../../../projects/Atlas/brief.md') &&
            content.includes('../../../../projects/Atlas/checklist.md#review'),
          completed: (await readFile(professional, 'utf8')).includes('- ~~Review the draft~~'),
          remaining: (await next()).map((item) => item.text),
        },
        expected: {
          status: 200,
          categories: ['Personal', 'Professional', 'Professional'],
          relative: true,
          completed: true,
          remaining: ['Send the invoice', 'Plan the workshop'],
        },
      })
      const undone = await post('undo', { id: moved.undo })
      assert({
        given: 'Undo while the files still match the move',
        should: 'restore all three original files byte for byte',
        actual: [
          undone.status,
          await readFile(file, 'utf8'),
          await readFile(professional, 'utf8'),
          await readFile(personal, 'utf8'),
        ],
        expected: [200, EMPTY, PROFESSIONAL, PERSONAL],
      })
    })
  },
)

test({ name: 'Next selections detect source edits, duplicates on the day, and timed or nested items' }, async () => {
  await withNotebook(async ({ next, post, professional, file }) => {
    const item = (await next()).find((item) => item.text.startsWith('Read Atlas'))!
    await writeFile(professional, PROFESSIONAL.replace('projects/Atlas/brief.md', 'projects/Atlas/new-brief.md'))
    const stale = await post('pull', { kind: 'todos', ids: [item.id], requestId: randomUUID() })
    await writeFile(
      professional,
      PROFESSIONAL + '\n## Content\n\n- 09:30 > A timed event\n- Task with notes\n  - A nested note\n',
    )
    await post('add', { kind: 'reminders', text: 'Water the plants', requestId: randomUUID() })
    const entries = await next()
    const already = entries.find((item) => item.text === 'Water the plants')!
    const duplicate = await post('pull', { kind: 'reminders', ids: [already.id], requestId: randomUUID() })
    const refused = entries.filter((item) => item.unavailable)
    const timed = await post('pull', { kind: 'todos', ids: [refused[0].id], requestId: randomUUID() })
    assert({
      given: 'stale, duplicate, timed and nested Next rows',
      should: 'refuse all unsafe moves without touching their sources',
      actual: [
        stale.status,
        duplicate.status,
        timed.status,
        already.already,
        refused.length,
        (await readFile(file, 'utf8')).includes('Read [Atlas]'),
      ],
      expected: [409, 409, 409, true, 2, false],
    })
  })
})

test({ name: 'Next moves to reminders and Undo preserves independent edits to both files' }, async () => {
  await withNotebook(async ({ next, post, professional, file }) => {
    const selected = (await next()).filter((item) => ['Send the invoice', 'Plan the workshop'].includes(item.text))
    const moved = (await (
      await post('pull', { kind: 'reminders', ids: selected.map((item) => item.id), requestId: randomUUID() })
    ).json()) as DayPlanResult
    await writeFile(file, (await readFile(file, 'utf8')) + '\nA new day note.\n')
    await writeFile(
      professional,
      (await readFile(professional, 'utf8')).replace('## Next', 'A new source note.\n\n## Next'),
    )
    const undone = await post('undo', { id: moved.undo })
    assert({
      given: 'two moved reminders and unrelated file edits',
      should: 'restore the original source rows and preserve the edits',
      actual: [
        undone.status,
        moved.view.record.reminders.length,
        (await readFile(file, 'utf8')).includes('A new day note.'),
        await readFile(professional, 'utf8'),
      ],
      expected: [200, 2, true, PROFESSIONAL.replace('## Next', 'A new source note.\n\n## Next')],
    })
  })
})

test({ name: 'a failed source write rolls back the destination and any earlier source write' }, async () => {
  await withNotebook(
    async ({ next, post, file, professional, personal }) => {
      const items = (await next()).filter((item) => ['Review the draft', 'Water the plants'].includes(item.text))
      const result = await post('pull', { kind: 'todos', ids: items.map((item) => item.id), requestId: randomUUID() })
      assert({
        given: 'an I/O failure writing the second Next source',
        should: 'leave all originals intact',
        actual: [
          result.status,
          await readFile(file, 'utf8'),
          await readFile(professional, 'utf8'),
          await readFile(personal, 'utf8'),
        ],
        expected: [500, EMPTY, PROFESSIONAL, PERSONAL],
      })
    },
    {
      writePlanning: async (file, content) => {
        if (file.endsWith('next-personal.md')) throw new Error('Simulated write failure')
        await atomicWrite(file, content)
      },
    },
  )
})

test(
  { name: 'planning rejects bad times, timed Next destinations, cross-origin writes and missing days' },
  async () => {
    await withNotebook(async ({ app, post, file }) => {
      const body = { kind: 'commitments', text: 'A sample commitment', time: '09:90', requestId: randomUUID() }
      const badTime = await post('add', body)
      const badEntry = await post('add', { ...body, kind: 'complete' })
      const missingTime = await post('add', { ...body, kind: 'complete', time: undefined })
      const timedNext = await post('pull', {
        kind: 'commitments',
        ids: ['unused'],
        time: '09:30',
        requestId: randomUUID(),
      })
      const headers = { 'content-type': 'application/json', origin: 'https://example.com' }
      const origin = await app.request(`/${DAY.ymd}/item/add`, { method: 'POST', headers, body: JSON.stringify(body) })
      const missing = await app.request('/2026-01-26/item/add', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...body, time: '09:30' }),
      })
      assert({
        given: 'invalid or unauthorized requests',
        should: 'reject them and leave the day untouched',
        actual: [
          badTime.status,
          badEntry.status,
          missingTime.status,
          timedNext.status,
          origin.status,
          missing.status,
          await readFile(file, 'utf8'),
        ],
        expected: [400, 400, 400, 400, 403, 404, EMPTY],
      })
    })
  },
)

test({ name: 'ending a day closes every planning mutation including an outstanding Undo' }, async () => {
  await withNotebook(async ({ next, post, file, professional }) => {
    const entry = (await next())[0]
    const added = (await (
      await post('add', { kind: 'todos', text: 'A sample task', requestId: randomUUID() })
    ).json()) as DayPlanResult
    const ended = (await readFile(file, 'utf8')).replace('ended:', 'ended: 17:00')
    await writeFile(file, ended)
    const requests = await Promise.all([
      post('add', { kind: 'todos', text: 'Another task', requestId: randomUUID() }),
      post('add', { kind: 'complete', text: 'A sample entry', time: '09:30', requestId: randomUUID() }),
      post('pull', { kind: 'todos', ids: [entry.id], requestId: randomUUID() }),
      post('undo', { id: added.undo }),
    ])
    assert({
      given: 'a client still showing a day after it ended',
      should: 'return the ended view and preserve the day and Next files',
      actual: [
        requests.map((result) => result.status),
        ((await requests[0].json()) as { view: DayView }).view.record.ended,
        await readFile(file, 'utf8'),
        await readFile(professional, 'utf8'),
      ],
      expected: [[409, 409, 409, 409], true, ended, PROFESSIONAL],
    })
  })
})
