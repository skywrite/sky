import { readFile } from 'node:fs/promises'
import * as path from 'node:path'
import { sleepInput, TRACKING_TODAY, trackingFixture } from '#lib/tracking/testHelpers.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { createTrackingRoutes } from './mod.ts'

test('All time is available to reports and CSV exports', async () => {
  const f = await trackingFixture()
  try {
    await f.store.create(crypto.randomUUID(), sleepInput)
    await f.put('data/tracking/1901/sleep.csv', 'date, duration (hr), notes\n1901-02-03, 8, "Earlier history"\n')
    const app = createTrackingRoutes({ store: f.store })
    const response = await app.request('/report?name=sleep&days=all')
    const report = await response.json()
    const exported = await app.request('/sleep/export?days=all')
    assert({
      given: 'All time through the browser API and export link',
      should: 'include old observations without imposing a fixed-year cutoff',
      actual: [
        response.status,
        report.start,
        report.metrics[0].entries.length,
        exported.status,
        (await exported.text()).includes('Earlier history'),
      ],
      expected: [200, '1901-02-03', 1, 200, true],
    })
    assert({
      given: 'an unsupported range token',
      should: 'reject it instead of silently choosing another period',
      actual: (await app.request('/report?days=invalid')).status,
      expected: 400,
    })
  } finally {
    await f.dispose()
  }
})

test('tracking HTTP routes validate writes and keep sentence interpretation separate from saving', async () => {
  const moments: string[] = []
  const f = await trackingFixture(async (_definition, text, now) => {
    moments.push(`${now.date} ${now.time}`)
    if (text === 'unreadable') return null
    return {
      date: text === 'unclear date' ? null : new PlainDate('2030-06-17'),
      values: { duration: '7.5', notes: 'Late dinner' },
    }
  })
  try {
    const app = createTrackingRoutes({ store: f.store })
    const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
      app.request(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
      })
    const created = await post('/create', { operationId: crypto.randomUUID(), tracker: sleepInput })
    assert({
      given: 'a valid setup form',
      should: 'create a tracker and prohibit cached reports',
      actual: [created.status, (await app.request('/report')).headers.get('cache-control')],
      expected: [201, 'no-store'],
    })
    const tracker = (await f.store.report()).metrics[0].tracker
    const input = {
      operationId: crypto.randomUUID(),
      revision: tracker.revision,
      date: TRACKING_TODAY,
      values: { duration: '8' },
    }
    assert({
      given: 'cross-site, invalid date, unknown answer, and malformed JSON requests',
      should: 'reject them before changing the notebook',
      actual: [
        (await post('/sleep/entries', input, { origin: 'https://example.com' })).status,
        (await post('/sleep/entries', input, { 'sec-fetch-site': 'cross-site' })).status,
        (await post('/sleep/entries', { ...input, date: '2030-02-30' })).status,
        (await post('/sleep/entries', { ...input, values: { missing: '1' } })).status,
        (
          await app.request('/sleep/entries', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{bad',
          })
        ).status,
        (await app.request('/report?name=..')).status,
        (await post('/unknown/entries', input)).status,
        (await f.store.report()).metrics[0].entries.length,
      ],
      expected: [403, 403, 400, 400, 400, 400, 404, 0],
    })
    const previews = await Promise.all(
      ['yesterday 7h 30m', 'unclear date', 'unreadable'].map(async (text) =>
        (await post('/sleep/parse', { text })).json(),
      ),
    )
    assert({
      given: 'a sentence with yesterday, an unclear date, or no interpretation',
      should: 'resolve against the calendar date, leave unclear dates empty, and never save during review',
      actual: [previews.map((p) => p.date), moments, (await f.store.report()).metrics[0].entries.length],
      expected: [['2030-06-17', null, null], Array(3).fill('2030-06-18 8:15'), 0],
    })
    const saved = await post('/sleep/entries', { ...input, date: previews[0].date, values: previews[0].values })
    assert({
      given: 'an explicitly saved reviewed entry',
      should: 'write its exact backdated observation to CSV',
      actual: [
        saved.status,
        (await f.store.report()).metrics[0].entries.map((e) => [e.date, e.values.duration, e.values.notes]),
      ],
      expected: [200, [['2030-06-17', '7.5', 'Late dinner']]],
    })
    const csv = path.join(f.root, 'data/tracking/2030/sleep.csv')
    const before = await readFile(csv, 'utf8')
    const exported = await app.request('/sleep/export?start=2030-06-17&end=2030-06-17')
    assert({
      given: 'exporting a selected range',
      should: 'include all named values without modifying the source',
      actual: [
        exported.headers.get('content-type'),
        (await exported.text()).includes('"2030-06-17", "7.5", "Late dinner"'),
        await readFile(csv, 'utf8'),
      ],
      expected: ['text/csv; charset=utf-8', true, before],
    })
    const { undoId } = await saved.json()
    assert({
      given: 'Undo through the HTTP API',
      should: 'remove the saved observation',
      actual: [(await post('/undo', { id: undoId })).status, (await f.store.report()).metrics[0].entries.length],
      expected: [200, 0],
    })
  } finally {
    await f.dispose()
  }
})
