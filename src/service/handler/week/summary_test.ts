import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { dayDir, weekDir } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDateTime, Week, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { holding } from '../../activity.ts'
import { createWeekRoutes, type WeekRoutesOptions } from './mod.ts'
import type { WeekSummaryView } from './summary.ts'

const WEEK = Week.parse('2031-W11')
const DAILY = '# Daily summary\n\nThe Atlas checklist was reviewed and the next steps were written down.\n'
const SUMMARY = '# Weekly summary\n\nAtlas moved forward with a reviewed checklist.\n'

async function fixture(
  run: (options: WeekRoutesOptions, save: (file: string, text: string) => Promise<void>) => Promise<void>,
) {
  const base = await mkdtemp(path.join(tmpdir(), 'sky-week-summary-'))
  const timeDir = path.join(base, 'time')
  const save = async (file: string, text: string) => {
    const target = path.join(timeDir, file)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, text)
  }
  try {
    await run(
      {
        markdownBaseDir: base,
        timeDir,
        now: () => new ZonedDateTime(new PlainDateTime('08:00', '2031-03-17'), 'America/Chicago'),
      },
      save,
    )
  } finally {
    await rm(base, { recursive: true, force: true })
  }
}

const weeklyFile = (week = WEEK) => path.join(weekDir(week.startInYear), 'summary.md')
const dailyFile = (index: number) => path.join(dayDir(WEEK.days[index]), 'summary.md')
const read = async (app: ReturnType<typeof createWeekRoutes>, week = WEEK) =>
  (await (await app.request(`/${week}/summary`)).json()) as WeekSummaryView
const start = (app: ReturnType<typeof createWeekRoutes>, body: unknown = {}, week = WEEK) =>
  app.request(`/${week}/summary`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
async function settled(app: ReturnType<typeof createWeekRoutes>): Promise<WeekSummaryView> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const view = await read(app)
    if (!view.running) return view
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('The scripted summary did not finish')
}

test('weekly summary reports usable daily coverage and links damaged summaries for repair', async () => {
  await fixture(async (options, save) => {
    await save(dailyFile(0), DAILY)
    await save(dailyFile(1), 'stub')
    await save(dailyFile(2), `---\ntags: [broken\n---\n${DAILY}`)
    const view = await read(createWeekRoutes(options))
    assert({
      given: 'one daily summary, a stub, bad frontmatter, and four absent days',
      should: 'use the generator’s coverage rules and identify every gap in chronological order',
      actual: {
        complete: view.complete,
        enabled: view.enabled,
        available: view.availableDays,
        path: view.path,
        missing: view.missing.map((day) => [day.day, day.reason, day.path !== null]),
      },
      expected: {
        complete: true,
        enabled: false,
        available: 1,
        path: null,
        missing: [
          ['2031-03-11', 'The daily summary is too short to use', true],
          ['2031-03-12', 'The daily summary has invalid frontmatter', true],
          ['2031-03-13', 'No daily summary yet', false],
          ['2031-03-14', 'No daily summary yet', false],
          ['2031-03-15', 'No daily summary yet', false],
          ['2031-03-16', 'No daily summary yet', false],
        ],
      },
    })
  })
})

test('weekly summary rejects unfinished weeks, absent coverage, and unapproved partial coverage', async () => {
  await fixture(async (options, save) => {
    let calls = 0
    const app = createWeekRoutes({
      ...options,
      commands: {
        startDay: async () => {},
        summarizeWeek: async () => {
          calls++
        },
      },
    })
    const empty = await start(app, { allowMissing: true })
    await save(dailyFile(0), DAILY)
    const partial = await start(app)
    const current = await start(app, { allowMissing: true }, WEEK.next())
    const future = await start(app, { allowMissing: true }, WEEK.next().next())
    const disabled = await start(createWeekRoutes(options), { allowMissing: true })
    assert({
      given: 'requests that cannot produce a complete weekly record without another choice',
      should: 'explain the missing dates and refuse before calling the model',
      actual: [
        empty.status,
        partial.status,
        current.status,
        future.status,
        disabled.status,
        (await partial.json()).error.includes('2031-03-11'),
        calls,
      ],
      expected: [409, 409, 409, 409, 501, true, 0],
    })
  })
})

test('weekly summary runs once across duplicate requests and refreshes, then keeps the saved file', async () => {
  await fixture(async (options, save) => {
    await save(dailyFile(0), DAILY)
    const calls: unknown[] = []
    let finish!: () => void
    const wait = new Promise<void>((resolve) => {
      finish = resolve
    })
    const commands = {
      startDay: async () => {},
      summarizeWeek: async (week: Week, input: { allowMissing: boolean }) => {
        calls.push([week.toString(), input])
        await wait
        await save(weeklyFile(week), SUMMARY)
      },
    }
    const app = createWeekRoutes({ ...options, commands })
    try {
      const responses = await Promise.all([start(app, { allowMissing: true }), start(app, { allowMissing: true })])
      const pending = await read(app)
      assert({
        given: 'two tabs generating the same week and a page refresh while the model runs',
        should: 'answer promptly with one shared running job and protect it from service reload',
        actual: [
          responses.map((response) => response.status),
          pending.running,
          calls,
          holding().includes(`summarizing week ${WEEK}`),
        ],
        expected: [[202, 202], true, [['2031-W11', { allowMissing: true }]], true],
      })
    } finally {
      finish()
    }
    const done = await settled(app)
    const again = await start(app)
    const restarted = await read(createWeekRoutes({ ...options, commands }))
    assert({
      given: 'a finished summary, another click, and a new service instance',
      should: 'expose the saved file without overwriting or generating again',
      actual: [
        done.path,
        restarted.path,
        again.status,
        calls.length,
        await readFile(path.join(options.timeDir, weeklyFile()), 'utf8'),
        holding().includes(`summarizing week ${WEEK}`),
      ],
      expected: [path.join('time', weeklyFile()), path.join('time', weeklyFile()), 200, 1, SUMMARY, false],
    })
  })
})

test('weekly summary retains a generation failure for retry and accepts a completed week before Monday starts', async () => {
  await fixture(async (options, save) => {
    for (let index = 0; index < 7; index++) await save(dailyFile(index), DAILY)
    let calls = 0
    const app = createWeekRoutes({
      ...options,
      now: () => new ZonedDateTime(new PlainDateTime('30:00', '2031-03-16'), 'America/Chicago'),
      commands: {
        startDay: async () => {},
        summarizeWeek: async () => {
          if (++calls === 1) throw new Error('The summary provider is unavailable. Try again.')
          await save(weeklyFile(), SUMMARY)
        },
      },
    })
    const first = await start(app)
    const failed = await settled(app)
    const second = await start(app)
    const done = await settled(app)
    assert({
      given: 'Monday morning on an extended Sunday notebook clock and a transient provider failure',
      should: 'allow the completed week, show the week-specific error, and retry successfully',
      actual: [first.status, failed.error, failed.running, second.status, done.path, done.error, calls],
      expected: [
        202,
        'Could not summarize week 2031-W11: The summary provider is unavailable. Try again.',
        false,
        202,
        path.join('time', weeklyFile()),
        null,
        2,
      ],
    })
  })
})

test('weekly summary validates the week, explicit partial-coverage choice, and request origin', async () => {
  await fixture(async (options) => {
    const app = createWeekRoutes(options)
    const invalid = await app.request('/2031-W99/summary')
    const traversal = await app.request('/not-a-week/summary')
    const body = await start(app, { allowMissing: 'yes' })
    const array = await start(app, [])
    const crossOrigin = await app.request(`/${WEEK}/summary`, {
      method: 'POST',
      headers: { origin: 'https://example.com', 'content-type': 'application/json' },
      body: '{}',
    })
    const form = await app.request(`/${WEEK}/summary`, { method: 'POST', body: '{}' })
    assert({
      given: 'invalid weeks, ambiguous choices, and requests from another site',
      should: 'reject each before starting work',
      actual: [invalid.status, traversal.status, body.status, array.status, crossOrigin.status, form.status],
      expected: [404, 404, 400, 400, 403, 415],
    })
  })
})
