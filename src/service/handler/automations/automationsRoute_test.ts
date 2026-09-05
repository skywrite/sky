import { makeTempDir } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import { createTestHttpApp } from '../httpTestHelpers.ts'
import type { AutomationsReport, AutomationsRoutesOptions } from './mod.ts'

// The routes are what is under test: the report is scripted, so no test
// reads a real automations/ folder or the machine's run-state.

const REPORT: AutomationsReport = {
  rows: [
    {
      name: 'atlas-prices',
      run: 'prices:atlas:fetch',
      trigger: '07:00, 12:00, 18:00',
      frame: 'local',
      state: 'active',
      due: false,
      brief: 'Keep the day priced.',
      unknownKeys: [],
      file: 'atlas-prices.md',
      runs: [
        { utc: '2026-08-31 01:13', clock: '2026-08-30 18:13', outcome: 'acted', target: '18:00', lateMinutes: 13 },
        { utc: '2026-08-30 17:00', clock: '2026-08-30 12:00', outcome: 'acted', target: '12:00', lateMinutes: 0 },
      ],
      lastRun: {
        utc: '2026-08-31 01:13',
        clock: '2026-08-30 18:13',
        outcome: 'acted',
        target: '18:00',
        lateMinutes: 13,
      },
    },
    {
      name: 'inbox-sync',
      run: 'google:email:inbox:fetch',
      trigger: 'every 5m',
      frame: 'elapsed',
      state: 'paused',
      due: false,
      brief: '',
      unknownKeys: ['timezone'],
      file: 'inbox-sync.md',
      runs: [],
    },
  ],
  charterErrors: [{ path: '/notebook/automations/broken.md', error: 'Needs frontmatter carrying run: and a trigger' }],
  dir: '/notebook/automations',
}

const DRAFT = {
  name: 'morning-brief',
  contents: '---\nrun: day:start\nat: EVERY-WEEKDAY 07:00\nstatus: active\n---\n\nBrief me.\n',
  run: 'day:start',
  trigger: 'EVERY-WEEKDAY 07:00',
  frame: 'local',
  brief: 'Brief me.',
  revised: false,
}

function scripted(overrides: Partial<AutomationsRoutesOptions> = {}): AutomationsRoutesOptions {
  return {
    status: () => Promise.resolve(REPORT),
    setStatus: () => Promise.resolve(true),
    runNow: () => Promise.resolve({ outcome: 'nothing' }),
    draft: () => Promise.resolve(DRAFT),
    create: () => Promise.resolve({ kind: 'created' }),
    save: () => Promise.resolve({ kind: 'saved' }),
    ...overrides,
  }
}

async function appWith(automations: AutomationsRoutesOptions) {
  const tmp = await makeTempDir({ prefix: 'sky-automations-route-' })
  return createTestHttpApp([tmp], { automations })
}

test({ name: 'automations route - the page is the app shell, the report is under _api' }, async () => {
  const app = await appWith(scripted())

  const page = await app.request('http://localhost/automations')
  assert({
    given: 'a request for /automations',
    should: 'serve the client shell',
    actual: [page.status, (await page.text()).includes('id="root"')],
    expected: [200, true],
  })

  const response = await app.request('http://localhost/automations/_api/status')
  assert({
    given: 'a request for the report',
    should: 'answer with every row, charter errors included',
    actual: [response.status, (await response.json()) as AutomationsReport],
    expected: [200, REPORT],
  })
})

test({ name: 'automations route - a host failure is a 500 with the message' }, async () => {
  const app = await appWith(scripted({ status: () => Promise.reject(new Error('automations:status failed')) }))

  const response = await app.request('http://localhost/automations/_api/status')
  assert({
    given: 'a host that throws',
    should: 'answer 500 with the message',
    actual: [response.status, ((await response.json()) as { message: string }).message],
    expected: [500, 'automations:status failed'],
  })
})

test({ name: 'automations route - the status flip reaches the host, and bad input never does' }, async () => {
  const seen: [string, string][] = []
  const app = await appWith(
    scripted({
      setStatus: (name, status) => {
        seen.push([name, status])
        return Promise.resolve(name === 'atlas-prices')
      },
    }),
  )

  const flipped = await app.request('http://localhost/automations/_api/automation/atlas-prices/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'paused' }),
  })
  const unknown = await app.request('http://localhost/automations/_api/automation/nope/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'active' }),
  })
  const invalid = await app.request('http://localhost/automations/_api/automation/atlas-prices/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'off' }),
  })

  assert({
    given: 'a pause, an unknown name, and a made-up status word',
    should: 'flip, 404, and 400 without reaching the host',
    actual: [flipped.status, unknown.status, invalid.status, seen],
    expected: [
      200,
      404,
      400,
      [
        ['atlas-prices', 'paused'],
        ['nope', 'active'],
      ],
    ],
  })
})

test({ name: 'automations route - run now relays the report, failed runs included' }, async () => {
  const app = await appWith(
    scripted({
      runNow: (name) =>
        Promise.resolve(name === 'atlas-prices' ? { outcome: 'failed' as const, message: 'no network' } : null),
    }),
  )

  const ran = await app.request('http://localhost/automations/_api/automation/atlas-prices/run', { method: 'POST' })
  const unknown = await app.request('http://localhost/automations/_api/automation/nope/run', { method: 'POST' })

  assert({
    given: 'a forced run that failed, and an unknown name',
    should: 'answer with the outcome report, and 404',
    actual: [ran.status, await ran.json(), unknown.status],
    expected: [200, { outcome: 'failed', message: 'no network' }, 404],
  })
})

test({ name: 'automations route - draft relays the request, refuses a blank, reports model failure' }, async () => {
  const seen: [string, string | undefined][] = []
  const app = await appWith(
    scripted({
      draft: (request, revise) => {
        seen.push([request, revise])
        if (request === 'gibberish') return Promise.reject(new Error('The draft did not validate: no trigger'))
        return Promise.resolve(DRAFT)
      },
    }),
  )

  const post = (body: unknown) =>
    app.request('http://localhost/automations/_api/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  const drafted = await post({ request: 'brief me every weekday at 7' })
  const revised = await post({ request: 'skip fridays', revise: 'morning-brief' })
  const blank = await post({})
  const failed = await post({ request: 'gibberish' })

  assert({
    given: 'a fresh request, a revision, a blank, and a model failure',
    should: 'relay both real ones, 400 the blank, 502 the failure',
    actual: [drafted.status, await drafted.json(), revised.status, blank.status, failed.status, seen],
    expected: [
      200,
      DRAFT,
      200,
      400,
      502,
      [
        ['brief me every weekday at 7', undefined],
        ['skip fridays', 'morning-brief'],
        ['gibberish', undefined],
      ],
    ],
  })
})

test({ name: 'automations route - create writes once; collisions and bad charters are refused' }, async () => {
  const seen: string[] = []
  const app = await appWith(
    scripted({
      create: (name) => {
        seen.push(name)
        if (name === 'atlas-prices') return Promise.resolve({ kind: 'exists' })
        if (name === 'broken') return Promise.resolve({ kind: 'invalid', message: 'Needs frontmatter' })
        return Promise.resolve({ kind: 'created' })
      },
    }),
  )

  const post = (body: unknown) =>
    app.request('http://localhost/automations/_api/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  const created = await post({ name: 'morning-brief', contents: DRAFT.contents })
  const collided = await post({ name: 'atlas-prices', contents: DRAFT.contents })
  const invalid = await post({ name: 'broken', contents: 'prose' })
  const missing = await post({ name: 'x' })

  assert({
    given: 'a fresh create, a collision, an invalid charter, and a bodyless one',
    should: 'answer 200, 409, 400, 400',
    actual: [created.status, collided.status, invalid.status, missing.status, seen],
    expected: [200, 409, 400, 400, ['morning-brief', 'atlas-prices', 'broken']],
  })
})

test({ name: 'automations route - save overwrites one charter, 404s an unknown name' }, async () => {
  const app = await appWith(
    scripted({
      save: (name) => Promise.resolve(name === 'atlas-prices' ? { kind: 'saved' } : { kind: 'missing' }),
    }),
  )

  const saved = await app.request('http://localhost/automations/_api/automation/atlas-prices/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: DRAFT.contents }),
  })
  const unknown = await app.request('http://localhost/automations/_api/automation/nope/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: DRAFT.contents }),
  })

  assert({
    given: 'a revision saved to a real charter and to an unknown one',
    should: 'answer 200 and 404',
    actual: [saved.status, unknown.status],
    expected: [200, 404],
  })
})

test({ name: 'automations route - no host means no data route, but the page still serves' }, async () => {
  const tmp = await makeTempDir({ prefix: 'sky-automations-route-' })
  const app = createTestHttpApp([tmp])

  const page = await app.request('http://localhost/automations')
  const data = await app.request('http://localhost/automations/_api/status')
  assert({
    given: 'an app with no automations host',
    should: 'serve the shell and 404 the data',
    actual: [page.status, data.status],
    expected: [200, 404],
  })
})
