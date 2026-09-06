import { makeTempDir } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import { createTestHttpApp } from '../httpTestHelpers.ts'
import type { ClockRoutesOptions, ClockSnapshot, ConvertAnswer } from './mod.ts'

// The routes are what is under test: the clocks and the converter are
// scripted, so no test reads the machine's day files or calls a model.

const SNAPSHOT: ClockSnapshot = {
  notebook: { date: '2026-08-29', time: '32:07', timezone: 'America/New_York' },
  system: { date: '2026-08-30', time: '08:07', timezone: 'America/New_York' },
}

const ANSWER: ConvertAnswer = {
  local: { date: '2026-08-31', time: '16:00', timezone: 'America/New_York' },
  target: { date: '2026-09-01', time: '04:00', timezone: 'Asia/Hong_Kong', place: 'Harbor City' },
  utc: { date: '2026-08-31', time: '20:00', timezone: 'UTC' },
}

async function appWith(clock: ClockRoutesOptions) {
  const tmp = await makeTempDir({ prefix: 'sky-clock-route-' })
  return createTestHttpApp([tmp], { clock })
}

test({ name: 'clock route - the page is the app shell, the snapshot is under _api' }, async () => {
  const app = await appWith({
    now: () => SNAPSHOT,
    convert: () => Promise.resolve(ANSWER),
  })

  const page = await app.request('http://localhost/clock')
  assert({
    given: 'a request for /clock',
    should: 'serve the client shell',
    actual: [page.status, (await page.text()).includes('id="root"')],
    expected: [200, true],
  })

  const response = await app.request('http://localhost/clock/_api/now')
  assert({
    given: 'a request for the snapshot',
    should: 'answer with both clocks, extended notebook hours intact',
    actual: [response.status, (await response.json()) as ClockSnapshot],
    expected: [200, SNAPSHOT],
  })
})

test({ name: 'clock route - convert relays the raw line and the three rows' }, async () => {
  const seen: string[] = []
  const app = await appWith({
    now: () => SNAPSHOT,
    convert: (query) => {
      seen.push(query)
      return Promise.resolve(ANSWER)
    },
  })

  const response = await app.request('http://localhost/clock/_api/convert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: '3pm tomorrow in Harbor City' }),
  })
  assert({
    given: 'a query',
    should: 'hand the raw line to the converter and preserve the place separately from its timezone',
    actual: [response.status, seen, (await response.json()) as ConvertAnswer],
    expected: [200, ['3pm tomorrow in Harbor City'], ANSWER],
  })
})

test({ name: 'clock route - a missing query is refused, a converter failure is bad-gateway' }, async () => {
  const app = await appWith({
    now: () => SNAPSHOT,
    convert: () => Promise.reject(new Error('Failed to parse timezone query')),
  })

  const missing = await app.request('http://localhost/clock/_api/convert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  assert({
    given: 'a body with no query',
    should: 'answer 400 without running the converter',
    actual: [missing.status, ((await missing.json()) as { message: string }).message],
    expected: [400, 'Missing required field: query'],
  })

  const failed = await app.request('http://localhost/clock/_api/convert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'gibberish' }),
  })
  assert({
    given: 'a converter that throws',
    should: 'answer 502 with the message',
    actual: [failed.status, ((await failed.json()) as { message: string }).message],
    expected: [502, 'Failed to parse timezone query'],
  })
})
