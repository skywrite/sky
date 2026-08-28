import { mkdir } from 'node:fs/promises'
import { copyFile } from 'node:fs/promises'
import * as path from 'node:path'
import { makeTempDir } from '#shared/fs/mod.ts'
import { setUserSpeakerLabel } from '#shared/models/Chat/document/mod.ts'
import { dayDir } from '#shared/nbfs/mod.ts'
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
