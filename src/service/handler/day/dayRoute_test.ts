import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { copyFile } from 'node:fs/promises'
import * as path from 'node:path'
import { makeTempDir } from '#shared/fs/mod.ts'
import { setUserSpeakerLabel } from '#shared/models/Chat/document/mod.ts'
import { dayDir, dayFile } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { buildDayView, createDayRoutes, type DayView } from './mod.ts'

setUserSpeakerLabel('Jane')

const TODAY = new PlainDate('2026-01-27')
const FIXTURE_CHAT = path.join(
  import.meta.dirname!,
  '..',
  '..',
  '..',
  '_shared-ts',
  'models',
  'Chat',
  'ChatStore',
  'fixtures',
  'ai-chats',
  '09-30_Atlas-Launch-Planning.md',
)

/** A notebook root holding one chat filed under the fixed today. */
async function notebookWithOneChat(): Promise<string> {
  const base = await makeTempDir({ prefix: 'sky-day-route-' })
  const chatsDir = path.join(base, 'time', dayDir(TODAY), 'actions', 'ai-chats')
  await mkdir(chatsDir, { recursive: true })
  await copyFile(FIXTURE_CHAT, path.join(chatsDir, '09-30_Atlas-Launch-Planning.md'))
  return base
}

test({ name: 'day view - the week walks back from today, labelled the way people say it' }, async () => {
  const base = await notebookWithOneChat()
  const view: DayView = await buildDayView({
    markdownBaseDir: base,
    timeDir: path.join(base, 'time'),
    today: () => TODAY,
  })

  assert({
    given: 'a fixed Tuesday as today',
    should: 'list today and the six days before it, newest first, with weekday stamps',
    actual: view.days.map((d) => `${d.label} · ${d.meta}`),
    expected: [
      'Today · Tue 01-27',
      'Yesterday · Mon 01-26',
      'Sunday · Sun 01-25',
      'Saturday · Sat 01-24',
      'Friday · Fri 01-23',
      'Thursday · Thu 01-22',
      'Wednesday · Wed 01-21',
    ],
  })
})

test({ name: "day view - today's saved chats come along, relative to the notebook" }, async () => {
  const base = await notebookWithOneChat()
  const view = await buildDayView({ markdownBaseDir: base, timeDir: path.join(base, 'time'), today: () => TODAY })

  assert({
    given: "one transcript filed under today's ai-chats",
    should: 'list it with its time, title, and exchange count, path relative to the root',
    actual: view.chats,
    expected: [
      {
        path: path.join('time', dayDir(TODAY), 'actions', 'ai-chats', '09-30_Atlas-Launch-Planning.md'),
        time: '09:30',
        summary: 'Atlas Launch Planning',
        exchanges: 2,
      },
    ],
  })
})

test({ name: 'day view - a past day is a page of its own, without the Today section' }, async () => {
  const base = await notebookWithOneChat()
  const view = await buildDayView(
    { markdownBaseDir: base, timeDir: path.join(base, 'time'), today: () => TODAY },
    '2026-01-26',
  )

  assert({
    given: 'yesterday asked for by date',
    should: "carry yesterday's label and long date, no Today section, and still list the week from today",
    actual: {
      label: view.day.label,
      dateLabel: view.day.dateLabel,
      section: view.section,
      chats: view.chats,
      first: view.days[0].label,
    },
    expected: { label: 'Yesterday', dateLabel: 'Monday, January 26, 2026', section: null, chats: [], first: 'Today' },
  })
})

const TOGGLE_DAY_MD = `---
date: 2026-01-27
---

# **2026-01-27 - Tue**

## Professional Commitments

- 09:30 > Send the deck to Jane

## Professional Todos

- Reply to the vendor shortlist
- File the expense report

## Reminders

- Water the plants
`

/** POST a checkbox toggle and hand back status plus the served view. */
async function toggleRequest(
  app: ReturnType<typeof createDayRoutes>,
  body: unknown,
): Promise<{ status: number; view: DayView | null }> {
  const response = await app.request('/2026-01-27/item', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: response.status, view: response.status === 200 ? ((await response.json()) as DayView) : null }
}

test({ name: 'day route - the checkbox strikes an item, and un-striking brings it back verbatim' }, async () => {
  const base = await notebookWithOneChat()
  const file = path.join(base, 'time', dayFile(TODAY))
  await writeFile(file, TOGGLE_DAY_MD)
  const app = createDayRoutes({ markdownBaseDir: base, timeDir: path.join(base, 'time'), today: () => TODAY })

  const struck = await toggleRequest(app, { list: 'Professional Todos', raw: 'File the expense report', done: true })
  const afterStrike = await readFile(file, 'utf8')
  const undone = await toggleRequest(app, {
    list: 'Professional Todos',
    raw: '~~File the expense report~~',
    done: false,
  })

  assert({
    given: 'a todo checked and then unchecked by its exact list and text',
    should: 'strike it in the file, report it done in the served record, and restore the original line on undo',
    actual: {
      struckStatus: struck.status,
      struckLine: afterStrike.includes('- ~~File the expense report~~'),
      recordSaysDone: struck.view?.record.todos.find((t) => t.text === 'File the expense report')?.done,
      undoneStatus: undone.status,
      restored: (await readFile(file, 'utf8')) === TOGGLE_DAY_MD,
    },
    expected: { struckStatus: 200, struckLine: true, recordSaysDone: true, undoneStatus: 200, restored: true },
  })
})

test({ name: 'day route - a timed commitment strikes with its time outside the marks' }, async () => {
  const base = await notebookWithOneChat()
  const file = path.join(base, 'time', dayFile(TODAY))
  await writeFile(file, TOGGLE_DAY_MD)
  const app = createDayRoutes({ markdownBaseDir: base, timeDir: path.join(base, 'time'), today: () => TODAY })

  const struck = await toggleRequest(app, {
    list: 'Professional Commitments',
    raw: '09:30 > Send the deck to Jane',
    done: true,
  })
  const afterStrike = await readFile(file, 'utf8')
  // Undo addresses the line by its text alone — the client never reconstructs the struck form.
  const undone = await toggleRequest(app, {
    list: 'Professional Commitments',
    raw: '09:30 > Send the deck to Jane',
    done: false,
  })

  assert({
    given: 'a timed commitment checked and then unchecked by its original text',
    should: "strike it in Day.isItemDone's timed form — the time stays readable — and restore the line on undo",
    actual: {
      struckStatus: struck.status,
      struckLine: afterStrike.includes('- 09:30 > ~~Send the deck to Jane~~'),
      wholeWrapAbsent: !afterStrike.includes('- ~~09:30'),
      recordSaysDone: struck.view?.record.commitments.find((c) => c.text === 'Send the deck to Jane')?.done,
      timeSurvives: struck.view?.record.commitments.find((c) => c.text === 'Send the deck to Jane')?.time,
      undoneStatus: undone.status,
      restored: (await readFile(file, 'utf8')) === TOGGLE_DAY_MD,
    },
    expected: {
      struckStatus: 200,
      struckLine: true,
      wholeWrapAbsent: true,
      recordSaysDone: true,
      timeSurvives: '09:30',
      undoneStatus: 200,
      restored: true,
    },
  })
})

test({ name: 'day route - a checkbox miss is a 404, and a malformed body a 400' }, async () => {
  const base = await notebookWithOneChat()
  await writeFile(path.join(base, 'time', dayFile(TODAY)), TOGGLE_DAY_MD)
  const app = createDayRoutes({ markdownBaseDir: base, timeDir: path.join(base, 'time'), today: () => TODAY })

  const staleText = await toggleRequest(app, {
    list: 'Professional Todos',
    raw: 'A line that is not there',
    done: true,
  })
  const wrongList = await toggleRequest(app, { list: 'Personal Todos', raw: 'Water the plants', done: true })
  const badBody = await toggleRequest(app, { list: 'Professional Todos' })
  const noFile = await app.request('/2026-01-20/item', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ list: 'Reminders', raw: 'Water the plants', done: true }),
  })

  assert({
    given: 'a stale item text, a wrong list, a body without done, and a day with no file',
    should: 'refuse each without writing — 404 for misses, 400 for the malformed body',
    actual: [staleText.status, wrongList.status, badBody.status, noFile.status],
    expected: [404, 404, 400, 404],
  })
})

test({ name: 'day route - a date that is not a day is not found' }, async () => {
  const base = await notebookWithOneChat()
  const app = createDayRoutes({ markdownBaseDir: base, timeDir: path.join(base, 'time'), today: () => TODAY })
  const statuses = await Promise.all(
    ['/2026-13-45', '/yesterday', '/2026-01-26'].map(async (p) => (await Promise.resolve(app.request(p))).status),
  )

  assert({
    given: 'a month that does not exist, a word, and a real day',
    should: 'refuse the first two and serve the third',
    actual: statuses,
    expected: [404, 404, 200],
  })
})
