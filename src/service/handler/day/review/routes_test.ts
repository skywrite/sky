import { mkdir, readFile, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { exists } from '#shared/fs/mod.ts'
import { daySummaryPath } from '#shared/nbfs/daySummary.ts'
import { assert, test } from '#test'
import { reviewFixture, REVIEW_DAY, REVIEW_TODAY } from './testFixture.ts'
import { isReminder, reviewItemStep, type ReviewView } from './types.ts'

test('real review actions carry duplicate todos and reminders, check streaks and save dated tracking without start or end', async () => {
  const f = await reviewFixture()
  try {
    await f.post(`${REVIEW_DAY}/open`)
    const initial = await f.view()
    const carried = initial.items.filter((i) => i.kind === 'carry')
    const ids = carried.filter((i) => !isReminder(i)).map((i) => i.id)
    const first = await f.post(`${REVIEW_DAY}/copy`, { ids })
    const retry = await f.post(`${REVIEW_DAY}/copy`, { ids })
    const moved = await f.post(`${REVIEW_DAY}/move`, { ids: carried.filter(isReminder).map((i) => i.id) })
    assert({
      given: 'duplicate todos and a reminder',
      should: 'copy the to-dos once, accept a retry, and move the reminder',
      actual: [first.status, retry.status, moved.status, (await f.view()).step],
      expected: [200, 200, 200, 'carry'],
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
        (yesterday.match(/^- Review Atlas outline$/gm) ?? []).length,
        yesterday.includes('- Water the plants'),
        /started:.*\d/.test(today),
        /ended:.*\d/.test(yesterday),
        yesterday.includes('~~Read a chapter~~'),
        report.metrics[0].entries.map((entry) => [entry.date, entry.values.hours]),
        f.calls,
      ],
      expected: [2, true, 2, false, false, false, true, [[REVIEW_DAY, '3.5']], ['summary']],
    })
  } finally {
    await f.dispose()
  }
})

test('copying to-dos to today leaves the reviewed day as it was and adds nothing today already has', async () => {
  const f = await reviewFixture()
  try {
    await mkdir(path.dirname(f.file(REVIEW_TODAY)), { recursive: true })
    await writeFile(
      f.file(REVIEW_TODAY),
      '## Professional Todos\n\n- Review Atlas outline\n  Keep the attached notes.\n',
    )
    await f.post(`${REVIEW_DAY}/open`)
    const before = await f.readDay(REVIEW_DAY)
    const todos = (await f.view()).items.filter((i) => i.kind === 'carry' && !isReminder(i))
    const response = await f.post(`${REVIEW_DAY}/copy`, { ids: todos.map((i) => i.id) })
    const today = await f.readDay(REVIEW_TODAY)
    const view = await f.view()
    assert({
      given: 'two unfinished to-dos copied to a day that already has one of them',
      should: 'leave the reviewed day byte for byte, add only what today lacks, and stop asking about both',
      actual: [
        response.status,
        await f.readDay(REVIEW_DAY),
        today.match(/Keep the attached notes/g)?.length,
        today.match(/Keep this separate copy/g)?.length,
        view.items.filter((i) => i.kind === 'carry' && !isReminder(i)).length,
        Object.values(view.answers).map((answer) => [answer.result, answer.target]),
      ],
      expected: [
        200,
        before,
        1,
        1,
        0,
        [
          ['copied', REVIEW_TODAY],
          ['copied', REVIEW_TODAY],
        ],
      ],
    })
  } finally {
    await f.dispose()
  }
})

test('a reminder moves off its day and can never be copied, and a to-do can never be moved', async () => {
  const f = await reviewFixture()
  try {
    await f.post(`${REVIEW_DAY}/open`)
    const carried = (await f.view()).items.filter((i) => i.kind === 'carry')
    const reminder = carried.find(isReminder)!
    const todo = carried.find((i) => !isReminder(i))!
    const before = await f.readDay(REVIEW_DAY)
    const copied = await f.post(`${REVIEW_DAY}/copy`, { ids: [reminder.id] })
    const moved = await f.post(`${REVIEW_DAY}/move`, { ids: [todo.id] })
    assert({
      given: 'a request to copy a reminder and a request to move a to-do',
      should: 'keep each in its own step, refuse both requests and change nothing',
      actual: [
        reviewItemStep(todo),
        reviewItemStep(reminder),
        copied.status,
        moved.status,
        await f.readDay(REVIEW_DAY),
        await exists(f.file(REVIEW_TODAY)),
      ],
      expected: ['carry', 'reminder', 409, 409, before, false],
    })
    const response = await f.post(`${REVIEW_DAY}/move`, { ids: [reminder.id] })
    const day = await f.readDay(REVIEW_DAY)
    const today = await f.readDay(REVIEW_TODAY)
    assert({
      given: 'a reminder moved to today',
      should: 'take it off the reviewed day, put it on today once, and leave the to-dos alone',
      actual: [
        response.status,
        day.includes('Water the plants'),
        today.match(/Water the plants/g)?.length,
        day.match(/^- Review Atlas outline$/gm)?.length,
        (await f.view()).answers[reminder.id].result,
      ],
      expected: [200, false, 1, 2, 'moved'],
    })
  } finally {
    await f.dispose()
  }
})

test('Done finishes a task as the day page does: a to-do is struck and a reminder leaves the list', async () => {
  const f = await reviewFixture()
  try {
    await f.post(`${REVIEW_DAY}/open`)
    const carry = (await f.view()).items.filter((i) => i.kind === 'carry')
    const todo = carry[0]
    const reminder = carry.find((i) => i.detail === 'Reminders')!
    const struck = await f.post(`${REVIEW_DAY}/answer`, { id: todo.id, action: 'apply' })
    const cleared = await f.post(`${REVIEW_DAY}/answer`, { id: reminder.id, action: 'apply' })
    const day = await f.readDay(REVIEW_DAY)
    const view = await f.view()
    assert({
      given: 'Done on one of two matching to-dos and on a reminder',
      should: 'strike only that to-do with its notes, clear the reminder, and leave the other to-do to decide',
      actual: [
        struck.status,
        cleared.status,
        day.includes('- ~~Review Atlas outline~~\n  Keep the attached notes.'),
        day.includes('- Review Atlas outline\n  Keep this separate copy.'),
        day.includes('Water the plants'),
        view.items.filter((i) => i.kind === 'carry').map((i) => i.title),
        [view.answers[todo.id].result, view.answers[reminder.id].result],
      ],
      expected: [200, 200, true, true, false, ['Review Atlas outline'], ['done', 'done']],
    })
    await writeFile(daySummaryPath(f.file(REVIEW_DAY)), '# Summary\n')
    const left = (await f.view()).items.find((i) => i.kind === 'carry')!
    const before = await f.readDay(REVIEW_DAY)
    const blocked = await f.post(`${REVIEW_DAY}/answer`, { id: left.id, action: 'apply' })
    assert({
      given: 'Done on a task after the day has a saved summary',
      should: 'name the task, say why, and leave the day alone',
      actual: [blocked.status, ((await blocked.json()) as { message: string }).message, await f.readDay(REVIEW_DAY)],
      expected: [
        409,
        'Review Atlas outline: This day has a saved summary. Remove its summary to finish or bring tasks forward again.',
        before,
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
    const stale = await f.post(`${REVIEW_DAY}/copy`, { ids: [item.id] })
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

test('Stop refuses while no summary runs, ends a running one without a file, and Start again finishes it', async () => {
  const f = await reviewFixture()
  const summarize = f.runtime.summarize
  const started = Promise.withResolvers<void>()
  let summaries = 0
  f.runtime.summarize = (ymd, signal) => {
    if (++summaries > 1) return summarize(ymd, signal)
    started.resolve()
    return new Promise<void>((_, reject) => {
      signal.addEventListener('abort', () => reject(new Error('The operation was aborted.')))
    })
  }
  try {
    await f.post(`${REVIEW_DAY}/open`)
    const idle = await f.post(`${REVIEW_DAY}/stop`, { id: 'summary' })
    for (const item of (await f.view()).items) await f.post(`${REVIEW_DAY}/answer`, { id: item.id, action: 'skip' })
    await started.promise
    const stopped = await f.post(`${REVIEW_DAY}/stop`, { id: 'summary' })
    const view = (await stopped.json()) as ReviewView
    assert({
      given: 'Stop before the summary starts and again while it runs',
      should: 'refuse while nothing runs, then end the run with no file written',
      actual: [
        idle.status,
        ((await idle.json()) as { message: string }).message,
        stopped.status,
        view.summary,
        await exists(daySummaryPath(f.file(REVIEW_DAY))),
      ],
      expected: [
        409,
        'The summary is not running.',
        200,
        { id: 'summary', title: 'Daily summary', status: 'stopped', message: 'Stopped. Nothing was written.' },
        false,
      ],
    })
    await f.post(`${REVIEW_DAY}/retry`, { id: 'summary' })
    const done = await f.waitFor((view) => view.summary.status === 'done')
    assert({
      given: 'Start again',
      should: 'write the summary and offer it',
      actual: [summaries, done.summaryHref],
      expected: [2, `/${REVIEW_DAY}?view=summary`],
    })
  } finally {
    await f.dispose()
  }
})

test('the return prompt starts the waiting day once as it shows, and a review opened by hand starts none', async () => {
  const f = await reviewFixture()
  try {
    await f.post(`${REVIEW_DAY}/open`)
    const byHand = (await f.view()).start
    await Promise.all([
      f.post(`${REVIEW_DAY}/open`, { prompted: true }),
      f.post(`${REVIEW_DAY}/open`, { prompted: true }),
    ])
    const started = await f.waitFor((view) => view.start?.status === 'done')
    await f.post(`${REVIEW_DAY}/open`, { prompted: true })
    assert({
      given: 'a review opened by hand, then the prompt showing in two tabs at once and once more after a reload',
      should: 'start the waiting day once, as Start does, and name it',
      actual: [byHand, started.start, f.calls.filter((call) => call === 'start').length],
      expected: [null, { ymd: REVIEW_TODAY, weekday: 'Tuesday', status: 'done' }, 1],
    })
  } finally {
    await f.dispose()
  }
})

test('a start that fails says why, and Try again starts the waiting day', async () => {
  const f = await reviewFixture()
  const commands = f.dayOptions.commands!
  const startDay = commands.startDay
  commands.startDay = async () => {
    throw new Error('The weather service did not answer.')
  }
  try {
    const early = await f.post(`${REVIEW_DAY}/start`)
    await f.post(`${REVIEW_DAY}/open`, { prompted: true })
    const failed = await f.waitFor((view) => view.start?.status === 'error')
    commands.startDay = startDay
    const again = await f.post(`${REVIEW_DAY}/start`)
    const started = await f.waitFor((view) => view.start?.status === 'done')
    assert({
      given: 'Try again before any start, then a prompt whose start fails, then Try again',
      should: 'refuse the first, show which day did not start and why, then start it',
      actual: [
        early.status,
        failed.start,
        again.status,
        started.start,
        f.calls.filter((call) => call === 'start').length,
      ],
      expected: [
        409,
        { ymd: REVIEW_TODAY, weekday: 'Tuesday', status: 'error', message: 'The weather service did not answer.' },
        200,
        { ymd: REVIEW_TODAY, weekday: 'Tuesday', status: 'done' },
        1,
      ],
    })
  } finally {
    await f.dispose()
  }
})
