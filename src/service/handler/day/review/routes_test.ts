import { readFile, writeFile } from 'node:fs/promises'
import { assert, test } from '#test'
import { reviewFixture, REVIEW_DAY, REVIEW_TODAY } from './testFixture.ts'
import type { ReviewView } from './types.ts'

test('real review actions carry duplicate todos and reminders, check streaks and save dated tracking without start or end', async () => {
  const f = await reviewFixture()
  try {
    await f.post(`${REVIEW_DAY}/open`)
    await f.waitFor((view) => view.recaps.every((job) => job.status === 'done'))
    const initial = await f.view()
    const ids = initial.items.filter((i) => i.kind === 'carry').map((i) => i.id)
    const first = await f.post(`${REVIEW_DAY}/move`, { ids })
    const retry = await f.post(`${REVIEW_DAY}/move`, { ids })
    assert({
      given: 'duplicate todos and a reminder',
      should: 'move once and accept a retry',
      actual: [first.status, retry.status],
      expected: [200, 200],
    })
    const streak = initial.items.find((i) => i.kind === 'streak')!
    const tracked = initial.items.find((i) => i.kind === 'tracking')!
    await f.post(`${REVIEW_DAY}/answer`, { id: streak.id, action: 'apply' })
    await f.post(`${REVIEW_DAY}/draft`, { id: tracked.id, values: { hours: '3.5' } })
    await f.post(`${REVIEW_DAY}/close`)
    const reopened = (await (await f.makeRoutes().request(`/${REVIEW_DAY}`)).json()) as ReviewView
    assert({
      given: 'review closed and recreated',
      should: 'remember carry state and unfinished input',
      actual: [reopened.items.filter((i) => i.kind === 'carry').length, reopened.drafts[tracked.id]],
      expected: [0, { hours: '3.5' }],
    })
    await f.post(`${REVIEW_DAY}/open`)
    await f.post(`${REVIEW_DAY}/answer`, { id: tracked.id, action: 'apply', values: { hours: '3.5' } })
    const meeting = (await f.view()).items.find((i) => i.kind === 'meeting')!
    await f.post(`${REVIEW_DAY}/answer`, { id: meeting.id, action: 'skip' })
    await f.waitFor((view) => view.summary.status === 'done')
    const today = await f.readDay(REVIEW_TODAY)
    const yesterday = await f.readDay(REVIEW_DAY)
    const report = await f.tracking.report(REVIEW_DAY, REVIEW_DAY)
    assert({
      given: 'all choices resolved',
      should: 'write real dated data and one summary, keeping start/end manual',
      actual: [
        (today.match(/Review Atlas outline/g) ?? []).length,
        today.includes('Water the plants'),
        /started:.*\d/.test(today),
        /ended:.*\d/.test(yesterday),
        yesterday.includes('~~Read a chapter~~'),
        report.metrics[0].entries.map((entry) => [entry.date, entry.values.hours]),
        f.calls,
      ],
      expected: [
        2,
        true,
        false,
        false,
        true,
        [[REVIEW_DAY, '3.5']],
        ['slack', 'github', 'codex', 'claude-code', 'summary'],
      ],
    })
  } finally {
    await f.dispose()
  }
})

test('review rejects cross-origin, invalid dates, stale items and writes to ended days, while skip preserves notebook bytes', async () => {
  const f = await reviewFixture()
  try {
    const item = (await f.view()).items.find((i) => i.kind === 'carry')!
    const before = await f.readDay(REVIEW_DAY)
    await writeFile(f.file(REVIEW_DAY), before.replace('Review Atlas outline', 'Review Widget outline'))
    const stale = await f.post(`${REVIEW_DAY}/move`, { ids: [item.id] })
    const origin = await f.app.request(`/${REVIEW_DAY}/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://example.com' },
      body: '{}',
    })
    const invalid = await f.post('2030-99-40/open')
    const future = await f.post(`${REVIEW_TODAY}/open`)
    assert({
      given: 'invalid or stale requests',
      should: 'reject them before mutation',
      actual: [stale.status, origin.status, invalid.status, future.status],
      expected: [409, 403, 400, 409],
    })
    const ended = (await f.readDay(REVIEW_DAY)).replace('started: 08:00', 'started: 08:00\nended: 22:00')
    await writeFile(f.file(REVIEW_DAY), ended)
    const streak = (await f.view()).items.find((i) => i.kind === 'streak')!
    const blocked = await f.post(`${REVIEW_DAY}/answer`, { id: streak.id, action: 'apply' })
    const skipped = await f.post(`${REVIEW_DAY}/answer`, { id: streak.id, action: 'skip' })
    assert({
      given: 'an ended day',
      should: 'allow skipping review without changing its record',
      actual: [blocked.status, skipped.status, await readFile(f.file(REVIEW_DAY), 'utf8')],
      expected: [409, 200, ended],
    })
  } finally {
    await f.dispose()
  }
})
