import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { TrackingStore } from '#lib/tracking/store.ts'
import { makeTempDir } from '#shared/fs/mod.ts'
import { dayDir, dayFile } from '#shared/nbfs/mod.ts'
import { PlainDate, PlainDateTime, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import type { ThreadSummary } from '../../chat/mod.ts'
import { StreaksStore } from '../../streaks/store.ts'
import { createDayRoutes, type DayRoutesOptions } from '../mod.ts'
import { ReviewIdle } from './idle.ts'
import { createReviewRoutes } from './routes.ts'
import type { ReviewRuntime, ReviewView } from './types.ts'

export const REVIEW_DAY = '2030-06-17'
export const REVIEW_TODAY = '2030-06-18'
export async function reviewFixture() {
  const root = await makeTempDir({ prefix: 'sky-review-test-' })
  const timeDir = path.join(root, 'time')
  const stateDir = path.join(root, '.state/day-review')
  const file = (ymd: string) => path.join(timeDir, dayFile(ymd))
  await mkdir(path.dirname(file(REVIEW_DAY)), { recursive: true })
  await writeFile(
    file(REVIEW_DAY),
    `---
started: 08:00
tz: America/Chicago
---

## Professional Todos

- Review Atlas outline
  Keep the attached notes.
- Review Atlas outline
  Keep this separate copy.

## Reminders

- Water the plants

## Streaks

- Read a chapter
`,
  )
  const streaks = new StreaksStore(
    {
      root,
      timeDir,
      streaksDir: path.join(root, 'streaks'),
      stateDir: path.join(root, '.state/streaks'),
      dayStateDir: path.join(root, '.state/day-planning'),
    },
    async () => new PlainDateTime({ date: REVIEW_DAY, time: '32:00' }),
    async () => 'Personal',
  )
  await streaks.create({
    title: 'Read a chapter',
    rule: 'Read one chapter of a book.',
    schedule: 'daily',
    start: REVIEW_DAY,
  })
  const tracking = new TrackingStore(
    {
      root,
      timeDir,
      trackingDir: path.join(root, 'tracking'),
      dataTrackingDir: path.join(root, 'data/tracking'),
      stateDir: path.join(root, '.state/tracking'),
    },
    async () => ({ date: new PlainDate(REVIEW_TODAY), time: '08:00' }),
  )
  await tracking.create(crypto.randomUUID(), {
    title: 'Focused work',
    question: 'How many hours of focused work?',
    category: 'Work',
    ask: 'evening',
    schedule: 'daily',
    columns: [{ name: 'hours', type: 'number' }],
    start: REVIEW_DAY,
    end: null,
    markdown: '',
  })
  const idle = new ReviewIdle(stateDir)
  const calls: string[] = []
  const chats: ThreadSummary[] = ['Atlas planning', 'Widget questions'].map((title, index) => ({
    id: `ongoing-${index}`,
    title,
    day: '2030-06-16',
    when: '10:00',
    activity: { [REVIEW_DAY]: { when: '10:00', turns: 1 } },
    state: 'done',
    line: null,
    turns: 2,
    busy: false,
    saves: true,
    parent: null,
    inherited: 0,
    saved: null,
  }))
  const runtime: ReviewRuntime = {
    status: () => idle.status(),
    acknowledge: (day) => idle.acknowledge(day),
    recap: async (id) => {
      calls.push(id)
      return 'Saved recap.'
    },
    summarize: async (ymd) => {
      calls.push('summary')
      await writeFile(
        path.join(timeDir, dayDir(ymd), 'summary.md'),
        '---\nsummary: A focused day\n---\n\n# Daily Summary\n\nAtlas planning moved forward.\n',
      )
    },
  }
  const now = () => new ZonedDateTime({ date: REVIEW_DAY, time: '32:00', timezone: 'America/Chicago' })
  const dayOptions: DayRoutesOptions = {
    timeDir,
    markdownBaseDir: root,
    today: () => new PlainDate(REVIEW_DAY),
    planningToday: () => new PlainDate(REVIEW_TODAY),
    now,
    ownerNames: [],
    commands: {
      startDay: async () => {
        calls.push('start')
      },
    },
    files: { userDataDir: path.join(root, '.state'), timeDir, markdownBaseDir: root },
  }
  const dayRoutes = createDayRoutes(dayOptions)
  const makeRoutes = () =>
    createReviewRoutes({
      day: dayOptions,
      dayRoutes,
      stateDir,
      runtime,
      streaks,
      tracking,
      chats: {
        list: async () => chats,
        close: async (id) => {
          calls.push('close-chat')
          chats.splice(
            chats.findIndex((chat) => chat.id === id),
            1,
          )
        },
      },
      schedule: async () => ({
        read: true,
        errors: [],
        meetings: [
          {
            title: 'Atlas planning',
            start: '10:00',
            end: '10:30',
            allDay: false,
            who: ['Jane Doe'],
            joinUrl: null,
            state: 'past',
            record: null,
          },
        ],
      }),
    })
  const app = makeRoutes()
  const post = (route: string, body: unknown = {}) =>
    app.request(`/${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  const view = async () => (await (await app.request(`/${REVIEW_DAY}`)).json()) as ReviewView
  const waitFor = async (predicate: (view: ReviewView) => boolean) => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const value = await view()
      if (predicate(value)) return value
      await Bun.sleep(10)
    }
    throw new Error('Review did not settle.')
  }
  return {
    root,
    timeDir,
    now,
    file,
    calls,
    chats,
    runtime,
    idle,
    app,
    makeRoutes,
    dayOptions,
    dayRoutes,
    tracking,
    streaks,
    post,
    view,
    waitFor,
    readDay: (ymd: string) => readFile(file(ymd), 'utf8'),
    dispose: () => rm(root, { recursive: true, force: true }),
  }
}
