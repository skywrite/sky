import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { makeTempDir } from '#shared/fs/mod.ts'
import { dayFile } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { createDayRoutes, type DayRoutesOptions, type DayView } from './mod.ts'

const DAY = new PlainDate('2026-01-27')
const RAW = 'Read [Atlas][brief] and [the checklist](checklist.md#review)'
const CONTENT = `---
started: 08:00
ended:
tz: America/Chicago
---

# A sample day

## Professional Todos

An example:

\`\`\`markdown
- ${RAW}
\`\`\`

* ${RAW}
  A note with [its own link](notes.md).
  - Keep this nested task.
* Review the budget
* ~~Send the outline~~

## Personal Commitments

- 09:00 > Buy supplies
- 11:00 > Call Jane Doe

## Reminders

- Water the plants

[brief]: brief.md "Atlas brief"
`

async function withDay(
  run: (context: {
    app: ReturnType<typeof createDayRoutes>
    post: (route: string, body: unknown) => Promise<Response>
    read: () => Promise<string>
    write: (content: string) => Promise<void>
  }) => Promise<void>,
  content = CONTENT,
  writePlanning?: DayRoutesOptions['writePlanning'],
) {
  const root = await makeTempDir({ prefix: 'day-edit-test-' })
  const timeDir = path.join(root, 'time')
  const file = path.join(timeDir, dayFile(DAY))
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, content)
  const app = createDayRoutes({ markdownBaseDir: root, timeDir, today: () => DAY, ownerNames: [], writePlanning })
  try {
    await run({
      app,
      post: async (route, body) =>
        app.request(`/${DAY.ymd}/item/${route}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
      read: () => readFile(file, 'utf8'),
      write: (content) => writeFile(file, content),
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
const edit = (raw: string, text: string, extra: Record<string, unknown> = {}) => ({
  list: 'Professional Todos',
  raw,
  text,
  requestId: randomUUID(),
  ...extra,
})
type Result = { view: DayView; undo: string; item: { list: string; raw: string } }

for (const eol of ['\n', '\r\n']) {
  test(`day edit preserves task notes, references, fenced examples and ${eol.length === 1 ? 'LF' : 'CRLF'} endings`, async () => {
    await withDay(
      async ({ post, read, write }) => {
        const input = edit(RAW, 'Review [Atlas][brief] and [the checklist](checklist.md#review)')
        const response = await post('edit', input)
        const result = (await response.json()) as Result
        assert({
          given: 'a linked task with notes and a fenced example with the same text',
          should: 'edit the real task and keep notes, examples and references',
          actual: {
            status: response.status,
            block: (await read()).includes(
              `* ${input.text}${eol}  A note with [its own link](notes.md).${eol}  - Keep this nested task.`,
            ),
            example: (await read()).includes(`\`\`\`markdown${eol}- ${RAW}${eol}\`\`\``),
            reference: (await read()).endsWith(`[brief]: brief.md "Atlas brief"${eol}`),
            bareLF: (await read()).replace(/\r\n/g, '').includes('\n'),
          },
          expected: { status: 200, block: true, example: true, reference: true, bareLF: eol === '\n' },
        })
        const saved = await read()
        const retry = await post('edit', input)
        assert({
          given: 'a retry after a lost response',
          should: 'return the same operation without another edit',
          actual: { status: retry.status, undo: ((await retry.json()) as Result).undo, content: await read() },
          expected: { status: 200, undo: result.undo, content: saved },
        })
        await write(saved + `${eol}A later note.${eol}`)
        const undo = await post('edit/undo', { id: result.undo })
        const undone = await read()
        assert({
          given: 'Undo after unrelated text was added',
          should: 'restore the item block and retain the later note',
          actual: {
            status: undo.status,
            restored: undone.includes(`* ${RAW}${eol}  A note with [its own link](notes.md).`),
            later: undone.endsWith(`A later note.${eol}`),
          },
          expected: { status: 200, restored: true, later: true },
        })
      },
      CONTENT.replace(/\n/g, eol),
    )
  })
}

test('day edit converts types and categories, carries notes, sorts times and undoes the move', async () => {
  await withDay(async ({ post, read }) => {
    const response = await post(
      'edit',
      edit(RAW, 'Review [Atlas][brief]', { kind: 'commitments', category: 'Personal', time: '10:30' }),
    )
    const result = (await response.json()) as Result
    assert({
      given: 'a to-do moved to a personal commitment',
      should: 'carry its notes and sort between neighboring times',
      actual: {
        status: response.status,
        times: result.view.record.commitments.map((item) => item.time),
        notes: (await read()).includes(
          '- 10:30 > Review [Atlas][brief]\n  A note with [its own link](notes.md).\n  - Keep this nested task.',
        ),
        oldTask: (await read()).includes(`* ${RAW}`),
      },
      expected: { status: 200, times: ['09:00', '10:30', '11:00'], notes: true, oldTask: false },
    })
    await post('edit/undo', { id: result.undo })
    assert({
      given: 'Undo with no intervening changes',
      should: 'restore every original byte',
      actual: await read(),
      expected: CONTENT,
    })
    const completed = await post(
      'edit',
      edit('~~Send the outline~~', 'Send the revised outline', {
        kind: 'commitments',
        category: 'Personal',
        time: '25:30',
      }),
    )
    const checked = (await completed.json()) as Result
    assert({
      given: 'a completed to-do rescheduled after midnight',
      should: 'keep completion and accept extended hours',
      actual: checked.view.record.commitments.map((item) => [item.time, item.done]),
      expected: [
        ['25:30', true],
        ['09:00', false],
        ['11:00', false],
      ],
    })
    const reminder = await post('edit', {
      ...edit('Water the plants', 'Water the garden'),
      list: 'Reminders',
      kind: 'todos',
      category: 'Personal',
      time: '',
    })
    const moved = (await reminder.json()) as Result
    assert({
      given: 'a reminder changed to a to-do in a new section',
      should: 'create that section and leave the old list empty',
      actual: {
        reminders: moved.view.record.reminders.length,
        todo: moved.view.record.todos.some((item) => item.text === 'Water the garden' && item.category === 'Personal'),
        empty: (await read()).includes('## Reminders\n\n-\n'),
      },
      expected: { reminders: 0, todo: true, empty: true },
    })
    const reverted = await post('edit', {
      ...edit('Water the garden', 'Remember the garden'),
      list: 'Personal Todos',
      kind: 'reminders',
      time: '',
    })
    assert({
      given: 'the to-do changed back to a reminder',
      should: 'show it in reminders',
      actual: ((await reverted.json()) as Result).view.record.reminders.map((item) => item.text),
      expected: ['Remember the garden'],
    })
  })
})

test('day edits reject stale, ambiguous, malformed, ended and linked-activity requests without writes', async () => {
  await withDay(async ({ post, read, write, app }) => {
    for (const [input, status] of [
      [edit('Missing task', 'New text'), 409],
      [edit('Review the budget', ''), 400],
      [edit('Review the budget', '~~Completed by text~~'), 400],
      [edit('Review the budget', 'New text', { kind: 'commitments', time: '28:99' }), 400],
      [edit('Review the budget', 'New text', { category: 'Personal\n## Injected' }), 400],
      [edit('Review the budget', '[Task](/workstreams/mock?activity=task)'), 400],
      [edit('[Task](/workstreams/mock?activity=task)', 'New text', { list: 'Workstream Todos' }), 409],
    ] as const) {
      const response = await post('edit', input)
      assert({
        given: 'an invalid or stale edit',
        should: 'reject it without writing',
        actual: { status: response.status, content: await read() },
        expected: { status, content: CONTENT },
      })
    }
    for (const route of ['edit', 'edit/undo']) {
      const response = await app.request(`/${DAY.ymd}/item/${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Origin: 'https://example.com' },
        body: JSON.stringify(edit('Review the budget', 'Changed')),
      })
      assert({
        given: `a cross-origin ${route} request`,
        should: 'reject before writing',
        actual: response.status,
        expected: 403,
      })
    }
    await write(CONTENT.replace('* Review the budget', '* Review the budget\n* Review the budget'))
    assert({
      given: 'identical source rows',
      should: 'refuse to guess which to edit',
      actual: (await post('edit', edit('Review the budget', 'Changed'))).status,
      expected: 409,
    })
    const endedContent = CONTENT.replace('ended:\n', 'ended: 13.5h\n')
    await write(endedContent)
    const ended = await post('edit', edit('Review the budget', 'Changed'))
    assert({
      given: 'a day that ended while editing',
      should: 'reject the edit with the ended view',
      actual: {
        status: ended.status,
        ended: ((await ended.json()) as { view: DayView }).view.record.ended,
        content: await read(),
      },
      expected: { status: 409, ended: true, content: endedContent },
    })
  })
})

test('edit Undo protects newer task notes and failed writes leave the original file intact', async () => {
  await withDay(async ({ post, read, write }) => {
    const result = (await (await post('edit', edit(RAW, 'Review [Atlas][brief]'))).json()) as Result
    const changed = (await read()).replace('A note with', 'An updated note with')
    await write(changed)
    const response = await post('edit/undo', { id: result.undo })
    assert({
      given: 'notes edited after renaming their task',
      should: 'refuse Undo instead of overwriting them',
      actual: { status: response.status, content: await read() },
      expected: { status: 409, content: changed },
    })
  })
  await withDay(
    async ({ post, read }) => {
      const response = await post('edit', edit('Review the budget', 'Review the new budget'))
      assert({
        given: 'a failed write',
        should: 'report failure without changing the task',
        actual: { status: response.status, content: await read() },
        expected: { status: 500, content: CONTENT },
      })
    },
    CONTENT,
    async () => {
      throw new Error('Mock write failure')
    },
  )
})

test('quick text edits preserve existing scheduling even for manually written untimed commitments', async () => {
  await withDay(
    async ({ post, read }) => {
      const response = await post('edit', {
        ...edit('Call Jane Doe', 'Call Jane Doe about the outline'),
        list: 'Personal Commitments',
      })
      assert({
        given: 'an untimed commitment renamed without opening scheduling fields',
        should: 'keep its existing list and timing',
        actual: { status: response.status, written: (await read()).includes('- Call Jane Doe about the outline') },
        expected: { status: 200, written: true },
      })
    },
    CONTENT.replace('11:00 > Call Jane Doe', 'Call Jane Doe'),
  )
})
