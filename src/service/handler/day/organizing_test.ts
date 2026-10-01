import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { atomicWrite, readOptional } from '#lib/outbox/files.ts'
import { makeTempDir } from '#shared/fs/mod.ts'
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
    write: (day: string, content: string) => Promise<void>
  }) => Promise<void>,
  content = CONTENT,
  writePlanning?: DayRoutesOptions['writePlanning'],
) {
  const root = await makeTempDir({ prefix: 'day-organize-test-' })
  const timeDir = path.join(root, 'time')
  const file = (day: string) => path.join(timeDir, dayFile(new PlainDate(day)))
  const write = async (day: string, content: string) => {
    await mkdir(path.dirname(file(day)), { recursive: true })
    await writeFile(file(day), content)
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

test('moves reject stale notes, invalid dates, ended days and foreign origins without writes', async () => {
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
    await write(TARGET, ended)
    assert({
      given: 'an ended destination',
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

test('ending the source closes every organizing action, and each route rejects cross-origin writes', async () => {
  await withDays(async ({ post, view, read, write }) => {
    const current = await view()
    const items = current.record.todos.map(({ list, raw, revision }) => ({ list, raw, revision }))
    const ordered = (await (
      await post('organize/reorder', { list: items[0].list, items: [...items].reverse(), requestId: randomUUID() })
    ).json()) as Result
    const ended = (await read())!.replace('ended:\n', 'ended: 12h\n')
    await write(DAY, ended)
    const actions = [
      ['move', { items: selected(current), date: TARGET, requestId: randomUUID() }],
      ['reorder', { list: items[0].list, items, requestId: randomUUID() }],
      ['order', { order: 'manual', requestId: randomUUID() }],
      ['undo', { id: ordered.undo }],
    ] as const
    for (const [route, body] of actions) {
      const rejected = await post(`organize/${route}`, body)
      assert({
        given: `an ended day and a ${route} request`,
        should: 'return the ended view without writing',
        actual: {
          status: rejected.status,
          ended: ((await rejected.json()) as { view: DayView }).view.record.ended,
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
