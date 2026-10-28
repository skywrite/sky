import { readFile, writeFile } from 'node:fs/promises'
import { daySummaryPath } from '#shared/nbfs/daySummary.ts'
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
      actual: [first.status, retry.status, (await f.view()).step],
      expected: [200, 200, 'carry'],
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
      should: 'write real dated data and one summary, keeping Start manual and never writing an end marker',
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

test('review rejects cross-origin, invalid dates, stale items and writes to summarized days, while skip preserves notebook bytes', async () => {
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
    await writeFile(daySummaryPath(f.file(REVIEW_DAY)), '# Summary\n')
    const streak = (await f.view()).items.find((i) => i.kind === 'streak')!
    const blocked = await f.post(`${REVIEW_DAY}/answer`, { id: streak.id, action: 'apply' })
    const skipped = await f.post(`${REVIEW_DAY}/answer`, { id: streak.id, action: 'skip' })
    assert({
      given: 'a summarized day',
      should: 'allow skipping review without changing its record',
      actual: [blocked.status, skipped.status, await readFile(f.file(REVIEW_DAY), 'utf8')],
      expected: [409, 200, ended],
    })
  } finally {
    await f.dispose()
  }
})

test('wizard navigation saves its place and skips a visible selection atomically without changing notebook content', async () => {
  const f = await reviewFixture()
  try {
    await f.post(`${REVIEW_DAY}/open`)
    await f.waitFor((view) => view.recaps.every((job) => job.status === 'done'))
    const before = await f.readDay(REVIEW_DAY)
    const initial = await f.view()
    const carry = initial.items.filter((item) => item.kind === 'carry')
    const tracking = initial.items.find((item) => item.kind === 'tracking')!
    const streak = initial.items.find((item) => item.kind === 'streak')!
    const skipped = await f.post(`${REVIEW_DAY}/step`, { step: 'streak', skipIds: carry.map((item) => item.id) })
    await f.post(`${REVIEW_DAY}/draft`, { id: tracking.id, values: { hours: '2.5' } })
    await f.post(`${REVIEW_DAY}/step`, { step: 'tracking' })
    await f.post(`${REVIEW_DAY}/close`)
    const resumed = (await (await f.makeRoutes().request(`/${REVIEW_DAY}`)).json()) as ReviewView
    assert({
      given: 'skip tasks, move to tracking, then close and recreate the review',
      should: 'keep the step, skipped items and draft while leaving the notebook alone',
      actual: [
        skipped.status,
        resumed.step,
        resumed.paused,
        Object.values(resumed.answers).map((answer) => answer.result),
        resumed.drafts[tracking.id],
        await f.readDay(REVIEW_DAY),
      ],
      expected: [200, 'tracking', true, ['skipped', 'skipped', 'skipped'], { hours: '2.5' }, before],
    })
    const stale = await f.post(`${REVIEW_DAY}/step`, {
      step: 'summary',
      skipIds: [streak.id, `meeting:${'0'.repeat(64)}`],
    })
    const invalid = await f.post(`${REVIEW_DAY}/step`, { step: 'unknown' })
    const unchanged = await f.view()
    assert({
      given: 'one stale item in a skip request, or an invalid step',
      should: 'save neither partial skips nor the new step',
      actual: [stale.status, invalid.status, unchanged.step, unchanged.answers, unchanged.drafts],
      expected: [409, 400, resumed.step, resumed.answers, resumed.drafts],
    })
    await f.post(`${REVIEW_DAY}/answer`, { id: carry[0].id, action: 'restore' })
    await f.post(`${REVIEW_DAY}/step`, { step: 'carry' })
    assert({
      given: 'return to a skipped step and review an item again',
      should: 'restore the decision without changing the day or starting a summary',
      actual: [
        (await f.view()).items.some((item) => item.id === carry[0].id),
        await f.readDay(REVIEW_DAY),
        f.calls.filter((call) => ['start', 'end', 'summary'].includes(call)),
      ],
      expected: [true, before, []],
    })
  } finally {
    await f.dispose()
  }
})

test('continuing chats are informational and closing one preserves the other conversations', async () => {
  const f = await reviewFixture()
  try {
    const initial = await f.view()
    await f.post(`${REVIEW_DAY}/step`, { step: 'chat' })
    const closed = await f.post(`${REVIEW_DAY}/chat/close`, { id: initial.chats[0].id })
    f.chats[0].saves = false
    const temporary = await f.post(`${REVIEW_DAY}/chat/close`, { id: f.chats[0].id })
    const unknown = await f.post(`${REVIEW_DAY}/chat/close`, { id: 'unknown' })
    assert({
      given: 'close one chat, then attempt to close a temporary or unknown chat from review',
      should: 'close only the chosen saved chat and retain the wizard step',
      actual: [closed.status, temporary.status, unknown.status, (await f.view()).step, f.chats.length, f.calls],
      expected: [200, 409, 409, 'chat', 1, ['close-chat']],
    })
  } finally {
    await f.dispose()
  }
})

test('the return prompt stays offered to every tab until a person acts on it', async () => {
  const f = await reviewFixture()
  try {
    await f.idle.sample(0, 0, REVIEW_DAY, REVIEW_DAY, 5)
    await f.idle.sample(6 * 3_600_000, 0, REVIEW_DAY, REVIEW_TODAY, 5)
    const pending = async () => ((await (await f.app.request('/status')).json()) as { pending: string | null }).pending
    await f.post(`${REVIEW_DAY}/open`, { prompted: true })
    await f.post(`${REVIEW_DAY}/open`, { prompted: true })
    const shown = await pending()
    const acknowledged = await f.post(`${REVIEW_DAY}/acknowledge`)
    assert({
      given: 'the prompt opened in two tabs, then a choice in one of them',
      should: 'keep offering the day until the choice, then stop',
      actual: [shown, acknowledged.status, await pending()],
      expected: [REVIEW_DAY, 200, null],
    })
  } finally {
    await f.dispose()
  }
})
