import { assert, test } from '#test'
import { readInput, STREAKS_TODAY, streaksFixture } from './testHelpers.ts'

test('streak routes reject invalid, cross-site, closed-day, and stale writes', async () => {
  const f = await streaksFixture()
  try {
    const created = await f.post('/create', { ...readInput, schedule: 'weekdays', start: '2026-05-15' })
    const report = await f.app.request('/report')
    assert({
      given: 'a valid new streak and report',
      should: 'create it and disable report caching',
      actual: [created.status, report.headers.get('cache-control')],
      expected: [201, 'no-store'],
    })
    const invalid = [
      { ...readInput, title: 'A\nsecond line' },
      { ...readInput, title: 'A ~ title' },
      { ...readInput, title: '08:00 > Read' },
      { ...readInput, title: 'Read — 3d' },
      { ...readInput, start: '2026-02-30' },
      { ...readInput, end: '2026-01-01' },
      { ...readInput, rule: '' },
      { ...readInput, schedule: 'sometimes' },
    ]
    assert({
      given: 'invalid definitions',
      should: 'reject them before creating files',
      actual: await Promise.all(invalid.map(async (input) => (await f.post('/create', input)).status)),
      expected: invalid.map(() => 400),
    })
    const body = { date: STREAKS_TODAY, done: true, expectedDone: false }
    const before = await f.day(STREAKS_TODAY)
    await f.day('2026-05-19', [], true)
    await f.day('2026-05-17')
    const endpoint = '/read-a-chapter/completion'
    assert({
      given: 'cross-site, non-JSON, future, ended, missing, and unscheduled requests',
      should: 'reject every write',
      actual: [
        (await f.post(endpoint, body, { origin: 'https://example.com' })).status,
        (await f.post(endpoint, body, { 'sec-fetch-site': 'cross-site' })).status,
        (await f.post(endpoint, body, { 'content-type': 'text/plain' })).status,
        (await f.post(endpoint, { ...body, date: '2026-05-21' })).status,
        (await f.post(endpoint, { ...body, date: '2026-05-19' })).status,
        (await f.post(endpoint, { ...body, date: '2026-05-18' })).status,
        (await f.post(endpoint, { ...body, date: '2026-05-17' })).status,
        await f.readDay(STREAKS_TODAY),
      ],
      expected: [403, 403, 415, 400, 409, 409, 400, before],
    })
    const saved = await f.post(endpoint, body)
    assert({
      given: 'a successful check-in followed by a stale retry',
      should: 'save once and reject the stale expected state',
      actual: [saved.status, (await f.post(endpoint, body)).status, (await f.store.report()).streaks[0].done],
      expected: [200, 409, [STREAKS_TODAY]],
    })
    const malformed = await f.app.request('/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{bad',
    })
    assert({
      given: 'malformed JSON and a missing habit',
      should: 'return useful client errors',
      actual: [malformed.status, (await f.post('/unknown/completion', body)).status],
      expected: [400, 404],
    })
  } finally {
    await f.dispose()
  }
})
