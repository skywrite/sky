import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { atomicWrite, readOptional } from '#lib/outbox/files.ts'
import { makeTempDir } from '#shared/fs/mod.ts'
import { daySummaryPath } from '#shared/nbfs/daySummary.ts'
import { dayFile } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { createDayRoutes, type DayRoutesOptions, type DayView } from './mod.ts'

const DAY = '2026-01-27'
const TARGET = '2026-01-28'
const CONTENT = `---
started: 08:00
ended:
tz: America/Chicago
# Keep this comment.
---

# A sample day

## Professional Todos

* Review [Atlas][brief]
  Keep [these notes](notes.md#section).
  - A nested checklist item
* Share the outline
* ~~Book the room~~

## Personal Commitments

- 09:00 > Buy supplies
- 25:30 > Call Jane Doe

## Reminders

- Water the plants

[brief]: brief.md "Atlas brief"
`

async function withDays(
  run: (env: {
    post: (route: string, body: unknown, origin?: string, day?: string) => Promise<Response>
    view: (day?: string) => Promise<DayView>
    read: (day?: string) => Promise<string | undefined>
    write: (day: string, content: string, summarized?: boolean) => Promise<void>
  }) => Promise<void>,
  content = CONTENT,
  writePlanning?: DayRoutesOptions['writePlanning'],
) {
  const root = await makeTempDir({ prefix: 'day-organize-test-' })
  const timeDir = path.join(root, 'time')
  const file = (day: string) => path.join(timeDir, dayFile(new PlainDate(day)))
  const write = async (day: string, content: string, summarized = false) => {
    await mkdir(path.dirname(file(day)), { recursive: true })
    await writeFile(file(day), content)
    if (summarized) await writeFile(daySummaryPath(file(day)), '# Summary\n')
  }
  await write(DAY, content)
  const app = createDayRoutes({
    timeDir,
    markdownBaseDir: root,
    today: () => new PlainDate(DAY),
    ownerNames: [],
    writePlanning,
  })
  try {
    await run({
      post: async (route, body, origin, day = DAY) =>
        app.request(`/${day}/item${route ? `/${route}` : ''}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(origin ? { Origin: origin } : {}) },
          body: JSON.stringify(body),
        }),
      view: async (day = DAY) => (await (await app.request(`/${day}`)).json()) as DayView,
      read: (day = DAY) => readOptional(file(day)),
      write,
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
const selected = (view: DayView) =>
  [view.record.todos[0], view.record.commitments[1], view.record.reminders[0]].map(
    ({ list, raw, occurrence, revision }) => ({
      list,
      raw,
      occurrence,
      revision,
    }),
  )
type Result = { view: DayView; undo: string; message: string; date?: string; undoRoute?: string }

const rankedTodos = (view: DayView) =>
  [...view.record.commitments, ...view.record.todos].sort((a, b) => a.priority! - b.priority!)
const priorityInput = (view: DayView, rows = rankedTodos(view)) => ({
  items: rows,
  revision: view.record.todoOrderRevision,
  requestId: randomUUID(),
})

test('reminder priorities survive editing, clearing and Undo without changing To-do priorities', async () => {
  const content = CONTENT
  await withDays(async ({ post, view, read, write }) => {
    await write(
      DAY,
      content.replace(
        '- Water the plants',
        '- Pause before replying\n  Keep the context.\n- Leave room for a walk\n- Pause before replying\n  A different reminder context.\n- Remember the long-term goal',
      ),
    )
    const initial = await view()
    await post('organize/priority', priorityInput(initial, rankedTodos(initial).reverse()))
    const before = await view()
    const reminders = before.record.reminders
    const requested = [reminders[2], reminders[1], reminders[0], ...reminders.slice(3)]
    const response = await post('organize/priority', {
      group: 'reminders',
      items: requested,
      revision: before.record.reminderOrderRevision,
      moved: JSON.stringify([requested[0].list, requested[0].raw.split('\n')[0], requested[0].occurrence ?? 0]),
      requestId: randomUUID(),
    })
    const ranked = (day: DayView) => [...day.record.reminders].sort((a, b) => a.priority! - b.priority!)
    const first = ranked(await view())[0]
    const edited = (await (
      await post('edit', {
        ...first,
        text: 'Pause before the Atlas review',
        kind: 'reminders',
        category: 'Professional',
        time: '',
        requestId: randomUUID(),
      })
    ).json()) as Result
    const afterEdit = ranked(edited.view)
    assert({
      given: 'an identical reminder promoted, then renamed',
      should: 'keep the correct reminder’s notes and override without changing To-do priorities',
      actual: [
        response.status,
        afterEdit[0].text,
        afterEdit[0].priorityManual,
        afterEdit[0].raw.includes('A different reminder context.'),
        rankedTodos(edited.view).map((item) => item.text),
      ],
      expected: [200, 'Pause before the Atlas review', true, true, rankedTodos(before).map((item) => item.text)],
    })
    const saved = (await read())!
    const deleted = (await (await post('delete', afterEdit[0])).json()) as { undo: string }
    await write(DAY, (await read())! + '\nAn unrelated day note.\n')
    assert({
      given: 'clearing a promoted reminder and adding an unrelated note',
      should: 'restore its original rank and notes on Undo, with the independent edit preserved',
      actual: [(await post('row/undo', { id: deleted.undo })).status, await read(), ranked(await view())[0].text],
      expected: [200, saved + '\nAn unrelated day note.\n', 'Pause before the Atlas review'],
    })
    const latest = await view()
    const reset = (await (
      await post('organize/priority', {
        group: 'reminders',
        items: latest.record.reminders,
        revision: latest.record.reminderOrderRevision,
        reset: true,
        requestId: randomUUID(),
      })
    ).json()) as Result
    assert({
      given: 'Use Sky’s order applied to Reminders',
      should: 'clear only reminder overrides and support Undo',
      actual: [
        reset.view.record.reminders.some((item) => item.priorityManual),
        rankedTodos(reset.view).map((item) => item.text),
        (await post('organize/undo', { id: reset.undo })).status,
        ranked(await view())[0].priorityManual,
      ],
      expected: [false, rankedTodos(before).map((item) => item.text), 200, true],
    })
    const current = await view()
    const snapshot = await read()
    const mixed = await post('organize/priority', {
      group: 'reminders',
      items: [...current.record.reminders, current.record.todos[0]],
      revision: current.record.reminderOrderRevision,
      requestId: randomUUID(),
    })
    assert({
      given: 'a priority request mixing reminders with a to-do',
      should: 'reject it without changing either list',
      actual: [mixed.status, await read()],
      expected: [400, snapshot],
    })
    const converted = (await (
      await post('edit', {
        ...ranked(current)[0],
        text: 'Share the outline',
        kind: 'todos',
        category: 'Professional',
        time: '',
        requestId: randomUUID(),
      })
    ).json()) as Result
    assert({
      given: 'a reminder converted into a to-do with the same title as an existing task',
      should: 'keep the existing task’s priority and the converted reminder’s own notes',
      actual: converted.view.record.todos
        .filter((item) => item.text === 'Share the outline')
        .map((item) => [item.raw.includes('A different reminder context.'), item.priorityManual]),
      expected: [
        [false, true],
        [true, false],
      ],
    })
    await write(DAY, (await read())! + '\nAnother independent note.\n')
    const undoConversion = await post('edit/undo', { id: converted.undo })
    const restored = await view()
    assert({
      given: 'Undo after converting a promoted reminder and writing another note',
      should: 'restore its reminder priority without replacing the new note or the other list’s priorities',
      actual: [
        undoConversion.status,
        ranked(restored).map((item) => [item.raw, item.priorityManual]),
        rankedTodos(restored).map((item) => [item.raw, item.priorityManual]),
        (await read())!.endsWith('\nAn unrelated day note.\n\nAnother independent note.\n'),
      ],
      expected: [
        200,
        ranked(current).map((item) => [item.raw, item.priorityManual]),
        rankedTodos(current).map((item) => [item.raw, item.priorityManual]),
        true,
      ],
    })
  })
})

test('To-do priority spans source categories and time, persists through edits, and keeps Most Important separate', async () => {
  await withDays(async ({ post, view, read }) => {
    const original = await view()
    const rows = rankedTodos(original)
    const input = priorityInput(original, [rows[4], rows[0], rows[3], rows[1], rows[2]])
    const response = await post('organize/priority', input)
    const result = (await response.json()) as Result
    const saved = (await read())!
    assert({
      given: 'an explicit priority order spanning untimed work and timed personal tasks',
      should: 'persist the combined ranking without moving source blocks or changing Most Important',
      actual: {
        status: response.status,
        order: rankedTodos(await view()).map((row) => row.text),
        source: saved.slice(saved.indexOf('# A sample day')),
        retry: (await post('organize/priority', input)).status,
      },
      expected: {
        status: 200,
        order: ['Call Jane Doe', 'Review [Atlas][brief]', 'Buy supplies', 'Share the outline', 'Book the room'],
        source: CONTENT.slice(CONTENT.indexOf('# A sample day')),
        retry: 200,
      },
    })
    const first = rankedTodos(result.view)[0]
    const edit = await post('edit', {
      ...first,
      text: 'Prepare the Atlas agenda',
      kind: 'todos',
      category: 'Professional',
      time: '',
      requestId: randomUUID(),
    })
    const edited = (await edit.json()) as Result
    assert({
      given: 'the top item renamed and moved from a timed personal task to an untimed professional task',
      should: 'keep its priority through the edit and through Undo',
      actual: [
        edit.status,
        rankedTodos(edited.view)[0].text,
        (await post('edit/undo', { id: edited.undo })).status,
        rankedTodos(await view())[0].text,
      ],
      expected: [200, 'Prepare the Atlas agenda', 200, 'Call Jane Doe'],
    })
    const latest = await view()
    const completed = await post('', { ...rankedTodos(latest)[0], done: true })
    const completedView = (await completed.json()) as DayView
    await post('add', { kind: 'todos', category: 'Personal', text: 'New unranked task', requestId: randomUUID() })
    assert({
      given: 'completion followed by an addition that can reorder the underlying file',
      should: 'retain the saved priority and place the new item after the manually ranked tasks',
      actual: [
        rankedTodos(completedView)
          .filter((row) => !row.done)
          .map((row) => row.text),
        rankedTodos(await view()).at(-1)?.text,
      ],
      expected: [['Review [Atlas][brief]', 'Buy supplies', 'Share the outline'], 'New unranked task'],
    })
  })
})

test('priority follows the right duplicate through completion, deletion and Undo', async () => {
  await withDays(async ({ post, view, read, write }) => {
    const original = await view()
    const rows = rankedTodos(original)
    const ordered = [rows[2], rows[1], rows[0], rows[3]]
    const result = (await (await post('organize/priority', priorityInput(original, ordered))).json()) as Result
    const chosen = rankedTodos(result.view)[0]
    const changed = (await (await post('', { ...chosen, done: true })).json()) as DayView & { itemUndo: string }
    assert({
      given: 'identical titles and notes, with the third copy ranked first',
      should: 'keep that exact copy first when completion moves it within the source list',
      actual: rankedTodos(changed).map((row) => [row.done, row.raw.includes('first copy')]),
      expected: [
        [true, false],
        [false, false],
        [false, true],
        [false, false],
      ],
    })
    await post('row/undo', { id: changed.itemUndo })
    const before = (await read())!
    const removed = (await (await post('delete', rankedTodos(await view())[0])).json()) as { undo: string }
    await write(DAY, (await read())! + '\nAn unrelated note.\n')
    assert({
      given: 'deletion of the promoted duplicate followed by an unrelated note',
      should: 'restore its priority and preserve the unrelated edit',
      actual: [(await post('row/undo', { id: removed.undo })).status, await read()],
      expected: [200, before + '\nAn unrelated note.\n'],
    })
  }, REPEATED)
})

test('priority saves refuse stale ordering, missing rows, notes changed elsewhere, Most Important and cross-site writes', async () => {
  await withDays(async ({ post, view, read, write }) => {
    const original = await view()
    const input = priorityInput(original, rankedTodos(original).reverse())
    await post('organize/priority', input)
    const latest = await view()
    const content = (await read())!
    const stale = await post('organize/priority', priorityInput(original))
    const missing = await post('organize/priority', priorityInput(latest, rankedTodos(latest).slice(1)))
    const outside = await post('organize/priority', {
      ...priorityInput(latest),
      items: [{ ...rankedTodos(latest)[0], list: 'Most Important' }],
    })
    const crossSite = await post('organize/priority', priorityInput(latest), 'https://example.com')
    await write(DAY, content.replace('Keep [these notes]', 'Updated [these notes]'))
    const notes = await post('organize/priority', priorityInput(latest))
    assert({
      given: 'stale and invalid reorder requests',
      should: 'reject them without losing newer content or accepting a cross-site mutation',
      actual: [stale.status, missing.status, outside.status, crossSite.status, notes.status, await read()],
      expected: [409, 409, 400, 403, 409, content.replace('Keep [these notes]', 'Updated [these notes]')],
    })
  })
})

const REPEATED = `---
started: 08:00
ended:
---

## Professional Todos

- Review the budget
  Notes for the first copy.
- Review the budget
  Notes shared by two separate copies.
  - Keep the nested checklist.
- Review the budget
  Notes shared by two separate copies.
  - Keep the nested checklist.
- Share the outline
`
const EXISTING = `## Professional Todos

- Review the budget
  Notes for the existing copy.
- Review the budget
  Notes shared by two separate copies.
  - Keep the nested checklist.
`

test('a copy reaches the destination like a move, leaves the source as it was, and never repeats a row', async () => {
  await withDays(async ({ post, view, read, write }) => {
    const existing = '## Professional Todos\n\n- Share the outline\n'
    await write(TARGET, existing)
    const items = (await view()).record.todos.filter((item) => !item.done)
    const response = await post('organize/move', { items, date: TARGET, requestId: randomUUID(), copy: true })
    const result = (await response.json()) as Result
    const saved = (await read(TARGET))!
    const again = await post('organize/move', { items, date: TARGET, requestId: randomUUID(), copy: true })
    assert({
      given: 'two unfinished to-dos copied, one already on the destination, then copied once more',
      should: 'keep the source byte for byte, carry the missing one with notes and links, and add nothing twice',
      actual: {
        status: response.status,
        source: await read(),
        shared: saved.match(/Share the outline/g)?.length,
        notes: saved.includes('A nested checklist item'),
        link: /Review \[Atlas\]\([^)]*brief\.md "Atlas brief"\)/.test(saved),
        again: again.status,
        target: await read(TARGET),
      },
      expected: { status: 200, source: CONTENT, shared: 1, notes: true, link: true, again: 200, target: saved },
    })
    const undo = await post('organize/undo', { id: result.undo })
    assert({
      given: 'Undo of a copy',
      should: 'take back only what the copy added',
      actual: { status: undo.status, source: await read(), target: await read(TARGET) },
      expected: { status: 200, source: CONTENT, target: existing },
    })
  })
})

test('moves keep repeated rows, destination copies and notes, with idempotent retry and precise Undo', async () => {
  await withDays(async ({ post, view, read, write }) => {
    await write(TARGET, EXISTING)
    const input = { items: (await view()).record.todos, date: TARGET, requestId: randomUUID() }
    const response = await post('organize/move', input)
    const result = (await response.json()) as Result
    const saved = (await read(TARGET))!
    const target = await view(TARGET)
    assert({
      given: 'repeated selected rows and matching destination rows, including completely identical blocks',
      should: 'move the whole selection, keeping every copy and its notes',
      actual: {
        status: response.status,
        source: (await view()).record.todos.length,
        target: target.record.todos.map((item) => [item.text, item.occurrence, Boolean(item.revision)]),
        nested: saved.match(/Keep the nested checklist/g)?.length,
        existing: saved.includes('Notes for the existing copy.'),
        sourceNotes: saved.includes('Notes for the first copy.'),
        retry: (await post('organize/move', input)).status,
        unchangedOnRetry: (await read(TARGET)) === saved,
      },
      expected: {
        status: 200,
        source: 0,
        target: [
          ['Review the budget', 0, true],
          ['Review the budget', 1, true],
          ['Review the budget', 2, true],
          ['Review the budget', 3, true],
          ['Review the budget', 4, true],
          ['Share the outline', 0, true],
        ],
        nested: 3,
        existing: true,
        sourceNotes: true,
        retry: 200,
        unchangedOnRetry: true,
      },
    })
    await write(DAY, (await read())! + '\nA later source note.\n')
    await write(
      TARGET,
      saved.replace('Notes for the existing copy.', 'Updated notes for the existing copy.') +
        '\nA later target note.\n',
    )
    const undo = await post('organize/undo', { id: result.undo })
    assert({
      given: 'Undo after unrelated prose and an existing duplicate were edited',
      should: 'remove only the moved copies and preserve the existing copies and newer edits',
      actual: { status: undo.status, source: await read(), target: await read(TARGET) },
      expected: {
        status: 200,
        source: REPEATED + '\nA later source note.\n',
        target:
          EXISTING.replace('Notes for the existing copy.', 'Updated notes for the existing copy.') +
          '\nA later target note.\n',
      },
    })
  }, REPEATED)
})

test('identical rows can be reordered, edited, checked and deleted individually with Undo', async () => {
  await withDays(async ({ post, view, read, write }) => {
    const original = (await view()).record.todos
    const reordered = await post('organize/reorder', {
      list: original[0].list,
      items: [original[2], original[0], original[1], original[3]],
      requestId: randomUUID(),
    })
    const order = (await reordered.json()) as Result
    assert({
      given: 'a permutation containing identical first lines and blocks',
      should: 'save each row once',
      actual: reordered.status,
      expected: 200,
    })
    await post('organize/undo', { id: order.undo })
    const item = (await view()).record.todos[2]
    const edited = await post('edit', {
      list: item.list,
      raw: item.raw,
      occurrence: item.occurrence,
      revision: item.revision,
      text: 'Review the revised budget',
      requestId: randomUUID(),
    })
    const edit = (await edited.json()) as Result
    assert({
      given: 'editing the last matching row',
      should: 'change only its title and retain its notes',
      actual: {
        status: edited.status,
        titles: edit.view.record.todos.map((item) => item.text),
        nested: (await read())?.match(/Keep the nested checklist/g)?.length,
      },
      expected: {
        status: 200,
        titles: ['Review the budget', 'Review the budget', 'Review the revised budget', 'Share the outline'],
        nested: 2,
      },
    })
    await write(DAY, (await read())! + '\nA later note.\n')
    await post('edit/undo', { id: edit.undo })
    const before = (await read())!
    const checked = await post('', { ...(await view()).record.todos[2], done: true })
    const check = (await checked.json()) as DayView & { itemUndo: string }
    assert({
      given: 'checking the last matching row',
      should: 'complete just that copy with its notes attached',
      actual: {
        status: checked.status,
        done: check.record.todos.filter((item) => item.done).length,
        nested: (await read())?.includes(
          '- ~~Review the budget~~\n  Notes shared by two separate copies.\n  - Keep the nested checklist.',
        ),
      },
      expected: { status: 200, done: 1, nested: true },
    })
    await post('row/undo', { id: check.itemUndo })
    assert({
      given: 'Undo after completing one copy',
      should: 'restore every copy exactly',
      actual: await read(),
      expected: before,
    })
    const deleted = await post('delete', (await view()).record.todos[2])
    const deletion = (await deleted.json()) as { view: DayView; undo: string }
    assert({
      given: 'deleting the last matching row',
      should: 'remove only that complete block',
      actual: {
        status: deleted.status,
        copies: deletion.view.record.todos.filter((item) => item.text === 'Review the budget').length,
        nested: (await read())?.match(/Keep the nested checklist/g)?.length,
      },
      expected: { status: 200, copies: 2, nested: 1 },
    })
    await write(DAY, (await read())! + '\nAnother later note.\n')
    await post('row/undo', { id: deletion.undo })
    assert({
      given: 'Undo of a duplicate deletion after a later edit',
      should: 'restore the deleted copy without losing later prose',
      actual: await read(),
      expected: before + '\nAnother later note.\n',
    })
  }, REPEATED)
})

test('a changed duplicate group invalidates old occurrences instead of targeting another copy', async () => {
  await withDays(async ({ post, view, read }) => {
    const items = (await view()).record.todos
    await post('delete', items[0])
    const before = await read()
    const stale = await post('organize/move', { items: [items[1]], date: TARGET, requestId: randomUUID() })
    const staleCheck = await post('', { ...items[1], done: true })
    assert({
      given: 'a preceding copy was deleted after selection',
      should: 'reject old addresses without changing another matching copy',
      actual: { move: stale.status, check: staleCheck.status, content: await read(), target: await read(TARGET) },
      expected: { move: 409, check: 409, content: before, target: undefined },
    })
  }, REPEATED)
})

for (const eol of ['\n', '\r\n'])
  test(`moving mixed task blocks preserves notes and links within the week (${eol.length})`, async () => {
    const original = CONTENT.replace(/\n/g, eol)
    await withDays(async ({ post, view, read, write }) => {
      const input = { items: selected(await view()), date: TARGET, requestId: randomUUID() }
      const response = await post('organize/move', input)
      const result = (await response.json()) as Result
      const target = (await read(TARGET))!
      const destination = await view(TARGET)
      assert({
        given: 'a selection spanning to-dos, commitments and reminders with a missing future day',
        should: 'create the target, move complete blocks and retain the extended time and categories',
        actual: {
          status: response.status,
          source: result.view.day.ymd,
          todos: destination.record.todos.length,
          time: destination.record.commitments[0]?.time,
          category: destination.record.commitments[0]?.category,
          reminder: destination.record.reminders[0]?.text,
          notes: target.includes('  - A nested checklist item'),
          links:
            /\[Atlas\]\([^)]*\/brief.md "Atlas brief"\)/.test(target) &&
            /\[these notes\]\([^)]*\/notes.md#section\)/.test(target),
          emptyReminder: (await read())?.includes(`## Reminders${eol}${eol}-${eol}`),
        },
        expected: {
          status: 200,
          source: DAY,
          todos: 1,
          time: '25:30',
          category: 'Personal',
          reminder: 'Water the plants',
          notes: true,
          links: true,
          emptyReminder: true,
        },
      })
      const retry = await post('organize/move', input)
      assert({
        given: 'a retry after a lost response',
        should: 'return the same move once',
        actual: { status: retry.status, target: await read(TARGET) },
        expected: { status: 200, target },
      })
      await write(DAY, (await read())! + `${eol}A later source note.${eol}`)
      await write(TARGET, target + '\nA later destination note.\n')
      const undo = await post('organize/undo', { id: result.undo })
      assert({
        given: 'Undo after unrelated edits on both days',
        should: 'restore the blocks and preserve later edits',
        actual: {
          status: undo.status,
          sourceTask: (await read())?.includes(`* Review [Atlas][brief]${eol}  Keep [these notes](notes.md#section).`),
          sourceNote: (await read())?.includes('A later source note.'),
          destinationNote: (await read(TARGET))?.includes('A later destination note.'),
          remaining: (await view(TARGET)).record.todos.length,
        },
        expected: { status: 200, sourceTask: true, sourceNote: true, destinationNote: true, remaining: 0 },
      })
    }, original)
  })

test('move undo restores exact source bytes and removes only an untouched day created by that move', async () => {
  await withDays(async ({ post, view, read }) => {
    const result = (await (
      await post('organize/move', { items: selected(await view()), date: TARGET, requestId: randomUUID() })
    ).json()) as Result
    const undo = await post('organize/undo', { id: result.undo })
    assert({
      given: 'Undo with both files unchanged',
      should: 'restore the source exactly and remove the new empty target',
      actual: { status: undo.status, source: await read(), target: await read(TARGET) },
      expected: { status: 200, source: CONTENT, target: undefined },
    })
    assert({
      given: 'a repeated Undo',
      should: 'succeed without changing anything',
      actual: (await post('organize/undo', { id: result.undo })).status,
      expected: 200,
    })
  })
})

test('moves reject stale notes, invalid dates, summarized days and foreign origins without writes', async () => {
  await withDays(async ({ post, view, read, write }) => {
    const input = { items: selected(await view()), date: TARGET, requestId: randomUUID() }
    for (const date of ['2026-02-30', '2026-01-26', DAY]) {
      assert({
        given: 'an invalid or unchanged destination date',
        should: 'reject the move',
        actual: (await post('organize/move', { ...input, date })).status,
        expected: 400,
      })
    }
    assert({
      given: 'a foreign-origin move',
      should: 'reject before writing',
      actual: (await post('organize/move', input, 'https://example.com')).status,
      expected: 403,
    })
    await write(DAY, CONTENT.replace('Keep [these notes]', 'Updated [these notes]'))
    assert({
      given: 'notes changed after selection',
      should: 'reject the stale selection',
      actual: (await post('organize/move', input)).status,
      expected: 409,
    })
    await write(DAY, CONTENT)
    const ended = '---\nended: 12h\n---\n\n## Reminders\n\n- Read a book\n'
    await write(TARGET, ended, true)
    assert({
      given: 'an summarized destination',
      should: 'leave both days intact',
      actual: { status: (await post('organize/move', input)).status, source: await read(), target: await read(TARGET) },
      expected: { status: 409, source: CONTENT, target: ended },
    })
  })
})

test('failed source writes roll back a newly created destination', async () => {
  let writes = 0
  await withDays(
    async ({ post, view, read }) => {
      const response = await post('organize/move', {
        items: selected(await view()),
        date: TARGET,
        requestId: randomUUID(),
      })
      assert({
        given: 'the destination saved but the source write failed',
        should: 'leave the original day and remove the temporary copy',
        actual: { status: response.status, source: await read(), target: await read(TARGET) },
        expected: { status: 500, source: CONTENT, target: undefined },
      })
    },
    CONTENT,
    async (file, content) => {
      if (++writes === 2) throw new Error('Mock write failure')
      await atomicWrite(file, content)
    },
  )
})

test('Undo refuses changed moved blocks without losing newer content', async () => {
  await withDays(async ({ post, view, read, write }) => {
    const result = (await (
      await post('organize/move', { items: selected(await view()), date: TARGET, requestId: randomUUID() })
    ).json()) as Result
    const source = await read()
    const changed = (await read(TARGET))!.replace('A nested checklist item', 'A revised nested item')
    await write(TARGET, changed)
    assert({
      given: 'a moved task whose notes were edited',
      should: 'refuse undo without overwriting either day',
      actual: {
        status: (await post('organize/undo', { id: result.undo })).status,
        source: await read(),
        target: await read(TARGET),
      },
      expected: { status: 409, source, target: changed },
    })
  })
})

test('manual task ordering persists through reads and edits, carries notes, and offers conflict-aware Undo', async () => {
  await withDays(async ({ post, view, read, write }) => {
    const rows = (await view()).record.todos
    const input = { list: rows[0].list, items: [rows[1], rows[2], rows[0]], requestId: randomUUID() }
    const response = await post('organize/reorder', input)
    const result = (await response.json()) as Result
    assert({
      given: 'a manual order with a completed task in the middle',
      should: 'save the order and preserve nested notes and YAML comments',
      actual: {
        status: response.status,
        rows: result.view.record.todos.map((row) => row.raw.split('\n')[0]),
        manual: result.view.record.manualOrder,
        comment: (await read())!.includes('# Keep this comment.'),
        block: (await read())!.includes(
          '* Review [Atlas][brief]\n  Keep [these notes](notes.md#section).\n  - A nested checklist item',
        ),
      },
      expected: {
        status: 200,
        rows: ['Share the outline', '~~Book the room~~', 'Review [Atlas][brief]'],
        manual: ['Professional Todos'],
        comment: true,
        block: true,
      },
    })
    await write(DAY, (await read())! + '\nAn unrelated note.\n')
    const undo = await post('organize/undo', { id: result.undo })
    assert({
      given: 'Undo after an unrelated note',
      should: 'restore list order without removing that note',
      actual: {
        status: undo.status,
        rows: (await view()).record.todos.map((row) => row.raw),
        note: (await read())!.endsWith('An unrelated note.\n'),
      },
      expected: { status: 200, rows: rows.map((row) => row.raw), note: true },
    })
    await post('organize/order', { order: 'manual', requestId: randomUUID() })
    const commitments = (await view()).record.commitments
    await post('organize/reorder', {
      list: commitments[0].list,
      items: [...commitments].reverse(),
      requestId: randomUUID(),
    })
    assert({
      given: 'commitments in Manual order',
      should: 'retain manual order and actual times',
      actual: {
        order: (await view()).record.commitmentsOrder,
        times: (await view()).record.commitments.map((item) => item.time),
      },
      expected: { order: 'manual', times: ['25:30', '09:00'] },
    })
    await post('organize/order', { order: 'time', requestId: randomUUID() })
    assert({
      given: 'switching back to Time order',
      should: 'sort the saved commitments by time',
      actual: (await view()).record.commitments.map((item) => item.time),
      expected: ['09:00', '25:30'],
    })
  })
})

test('Undo restores automatic order while keeping commitments added later', async () => {
  await withDays(async ({ post, view, read, write }) => {
    const result = (await (await post('organize/order', { order: 'manual', requestId: randomUUID() })).json()) as Result
    await write(
      DAY,
      (await read())!.replace('- 25:30 > Call Jane Doe', '- 25:30 > Call Jane Doe\n- 08:00 > Review notes'),
    )
    const response = await post('organize/undo', { id: result.undo })
    assert({
      given: 'an earlier commitment added while using Manual order',
      should: 'keep the new item and put the saved file back in Time order on Undo',
      actual: {
        status: response.status,
        order: (await view()).record.commitmentsOrder,
        sorted: (await read())!.includes('- 08:00 > Review notes\n- 09:00 > Buy supplies\n- 25:30 > Call Jane Doe'),
      },
      expected: { status: 200, order: 'time', sorted: true },
    })
  })
})

test('one save can edit and reschedule an item with idempotent retry and a single Undo', async () => {
  await withDays(async ({ post, view, read }) => {
    const item = (await view()).record.todos[0]
    const input = {
      ...item,
      text: 'Review the revised proposal',
      kind: 'commitments',
      category: 'Personal',
      time: '10:30',
      date: TARGET,
      requestId: randomUUID(),
    }
    const response = await post('edit', input)
    const result = (await response.json()) as Result
    assert({
      given: 'an editor save changing text, type, time, category and date',
      should: 'perform one move and return one Undo',
      actual: {
        status: response.status,
        route: result.undoRoute,
        title: (await view(TARGET)).record.commitments[0]?.text,
        time: (await view(TARGET)).record.commitments[0]?.time,
        retry: (await post('edit', input)).status,
      },
      expected: {
        status: 200,
        route: 'organize/undo',
        title: 'Review the revised proposal',
        time: '10:30',
        retry: 200,
      },
    })
    await post('organize/undo', { id: result.undo })
    assert({
      given: 'Undo of that edit and move',
      should: 'restore the entire original day',
      actual: await read(),
      expected: CONTENT,
    })
  })
})

test('summarizing the source closes every organizing action, and each route rejects cross-origin writes', async () => {
  await withDays(async ({ post, view, read, write }) => {
    const current = await view()
    const items = current.record.todos.map(({ list, raw, revision }) => ({ list, raw, revision }))
    const ordered = (await (
      await post('organize/reorder', { list: items[0].list, items: [...items].reverse(), requestId: randomUUID() })
    ).json()) as Result
    const ended = (await read())!.replace('ended:\n', 'ended: 12h\n')
    await write(DAY, ended, true)
    const actions = [
      ['move', { items: selected(current), date: TARGET, requestId: randomUUID() }],
      ['reorder', { list: items[0].list, items, requestId: randomUUID() }],
      ['order', { order: 'manual', requestId: randomUUID() }],
      ['undo', { id: ordered.undo }],
    ] as const
    for (const [route, body] of actions) {
      const rejected = await post(`organize/${route}`, body)
      assert({
        given: `an summarized day and a ${route} request`,
        should: 'return the summarized view without writing',
        actual: {
          status: rejected.status,
          ended: ((await rejected.json()) as { view: DayView }).view.record.summarized,
          content: await read(),
        },
        expected: { status: 409, ended: true, content: ended },
      })
      assert({
        given: `a cross-origin ${route} request`,
        should: 'reject before reaching the mutation',
        actual: (await post(`organize/${route}`, body, 'https://example.com')).status,
        expected: 403,
      })
    }
  })
})

test('stale references and list membership invalidate a pending reordering', async () => {
  await withDays(async ({ post, view, read, write }) => {
    const items = (await view()).record.todos.map(({ list, raw, revision }) => ({ list, raw, revision }))
    const input = { list: items[0].list, items: [...items].reverse(), requestId: randomUUID() }
    for (const changed of [
      CONTENT.replace('brief.md "Atlas brief"', 'revised.md "Atlas brief"'),
      CONTENT.replace('* Share the outline', '* A new task\n* Share the outline'),
    ]) {
      await write(DAY, changed)
      assert({
        given: 'a link definition or list membership changed after dragging began',
        should: 'reject the old permutation without overwriting the newer file',
        actual: { status: (await post('organize/reorder', input)).status, content: await read() },
        expected: { status: 409, content: changed },
      })
    }
  })
})
