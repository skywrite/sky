import { rm } from 'node:fs/promises'
import { makeTempDir } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import { DayReviewStore, type ReviewHost } from './store.ts'
import type { ReviewItem } from './types.ts'

const DAY = '2030-06-17'
const item: ReviewItem = { id: 'meeting:test', kind: 'meeting', title: 'Atlas planning' }
const RECAPS = ['slack', 'github', 'codex', 'claude-code'].map((id) => ({ id, title: `${id} recap`, saved: true }))

test('review saves skips and drafts across closing and restart, and summarizes exactly once', async () => {
  const dir = await makeTempDir({ prefix: 'sky-review-state-' })
  let summaryHref: string | null = null
  const calls: string[] = []
  const host: ReviewHost = {
    inventory: async () => ({ today: '2030-06-18', items: [item], hasDay: true, summarized: false, summaryHref }),
    apply: async () => {
      throw new Error('Not used')
    },
    runtime: {
      status: async () => ({ pending: null, supported: true }),
      acknowledge: async () => {},
      recaps: async () => RECAPS,
      recap: async (id) => {
        calls.push(id)
      },
      summarize: async () => {
        calls.push('summary')
        summaryHref = '/summary.md'
      },
    },
  }
  try {
    const store = new DayReviewStore(dir, host)
    await store.open(DAY)
    await store.draft(DAY, 'tracking:test', { duration: '7.5' })
    await store.close(DAY)
    await store.answer(DAY, item.id, 'skip')
    await store.settled(DAY)
    assert({
      given: 'the last item skipped after closing the review',
      should: 'save the skip but defer the summary',
      actual: [calls, (await store.view(DAY)).paused],
      expected: [[], true],
    })
    const resumed = new DayReviewStore(dir, host)
    const view = await resumed.open(DAY)
    await resumed.settled(DAY)
    await resumed.open(DAY)
    await resumed.settled(DAY)
    assert({
      given: 'reopen after restart and again after completion',
      should: 'retain drafts and skip, and run one summary',
      actual: [view.items, view.drafts, calls],
      expected: [[], { 'tracking:test': { duration: '7.5' } }, ['summary']],
    })
    summaryHref = null
    const removed = await resumed.refresh(DAY)
    await resumed.settled(DAY)
    assert({
      given: 'the summary is deleted after review completion',
      should: 'pause and reopen editing without recreating it during polling',
      actual: [removed.paused, removed.summary.status, calls.filter((c) => c === 'summary').length],
      expected: [true, 'waiting', 1],
    })
    await resumed.open(DAY)
    await resumed.settled(DAY)
    assert({
      given: 'explicitly reopen the review after deleting its summary',
      should: 'regenerate once while keeping the prior choices',
      actual: [calls.filter((c) => c === 'summary').length, (await resumed.view(DAY)).items.length],
      expected: [2, 0],
    })
    await resumed.answer(DAY, item.id, 'restore')
    await resumed.settled(DAY)
    assert({
      given: 'review a skipped item again',
      should: 'restore it without overwriting the saved summary',
      actual: [(await resumed.view(DAY)).items.length, calls.filter((c) => c === 'summary').length],
      expected: [1, 2],
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a missing recap holds the summary until the person runs it, and nothing runs on its own', async () => {
  const dir = await makeTempDir({ prefix: 'sky-review-run-' })
  const slack = Promise.withResolvers<void>()
  const saved = new Set(['github', 'claude-code'])
  const calls: string[] = []
  let summaryHref: string | null = null
  const store = new DayReviewStore(dir, {
    inventory: async () => ({ today: '2030-06-18', items: [item], hasDay: true, summarized: false, summaryHref }),
    apply: async () => {},
    runtime: {
      status: async () => ({ pending: null, supported: true }),
      acknowledge: async () => {},
      recaps: async () => RECAPS.map((recap) => ({ ...recap, saved: saved.has(recap.id) })),
      recap: async (id) => {
        calls.push(id)
        if (id !== 'slack') return 'Nothing to recap for this day.'
        await slack.promise
        saved.add(id)
      },
      summarize: async () => {
        calls.push('summary')
        summaryHref = '/summary.md'
      },
    },
  })
  try {
    await store.open(DAY)
    await store.answer(DAY, item.id, 'skip')
    await store.settled(DAY)
    const held = await store.view(DAY)
    await store.runRecaps(DAY, ['slack', 'codex', 'github'])
    for (let attempt = 0; attempt < 100 && calls.length < 2; attempt++) await Bun.sleep(10)
    const running = await store.view(DAY)
    assert({
      given: 'two missing recaps after the last item is skipped, then the person runs them and a saved one',
      should: 'run nothing on its own, hold the summary while any is missing or running, and skip the saved one',
      actual: [
        held.recaps.map((job) => job.status),
        held.summary.status,
        running.recaps.map((job) => job.status),
        running.summary.status,
        calls,
      ],
      expected: [
        ['missing', 'done', 'missing', 'done'],
        'waiting',
        ['running', 'done', 'done', 'done'],
        'waiting',
        ['slack', 'codex'],
      ],
    })
    slack.resolve()
    await store.settled(DAY)
    assert({
      given: 'the last running recap finishes',
      should: 'show every recap done, the quiet one with its reason, and write the summary once',
      actual: [(await store.view(DAY)).recaps.map((job) => [job.status, job.message ?? null]), calls],
      expected: [
        [
          ['done', null],
          ['done', null],
          ['done', 'Nothing to recap for this day.'],
          ['done', null],
        ],
        ['slack', 'codex', 'summary'],
      ],
    })
  } finally {
    slack.resolve()
    await store.settled(DAY)
    await rm(dir, { recursive: true, force: true })
  }
})

test('a failed recap holds the summary until the person retries or skips it', async () => {
  const dir = await makeTempDir({ prefix: 'sky-review-retry-' })
  let fail = true,
    summaries = 0
  let summaryHref: string | null = null
  const saved = new Set(['slack', 'codex', 'claude-code'])
  const calls: string[] = []
  const store = new DayReviewStore(dir, {
    inventory: async () => ({ today: '2030-06-18', items: [], hasDay: true, summarized: false, summaryHref }),
    apply: async () => {},
    runtime: {
      status: async () => ({ pending: null, supported: true }),
      acknowledge: async () => {},
      recaps: async () => RECAPS.map((recap) => ({ ...recap, saved: saved.has(recap.id) })),
      recap: async (id) => {
        calls.push(id)
        if (fail) throw new Error('GitHub could not be read.')
        saved.add(id)
      },
      summarize: async () => {
        summaries++
        summaryHref = '/summary.md'
      },
    },
  })
  try {
    await store.open(DAY)
    await store.runRecaps(DAY, ['github'])
    await store.settled(DAY)
    const failed = await store.view(DAY)
    await store.skipRecaps(DAY, ['github'])
    await store.settled(DAY)
    assert({
      given: 'a recap the person ran fails, then they write the summary without it',
      should: 'hold the summary with the reason shown, then write it once with the recap skipped',
      actual: [
        failed.recaps.find((job) => job.id === 'github'),
        failed.summary.status,
        summaries,
        (await store.view(DAY)).recaps.find((job) => job.id === 'github')?.status,
      ],
      expected: [
        { id: 'github', title: 'github recap', status: 'error', message: 'GitHub could not be read.' },
        'waiting',
        1,
        'skipped',
      ],
    })
    fail = false
    await store.runRecaps(DAY, ['github'])
    await store.settled(DAY)
    assert({
      given: 'the skipped recap run again once the source works',
      should: 'save it without writing the summary again',
      actual: [calls, (await store.view(DAY)).recaps.map((job) => job.status), summaries],
      expected: [['github', 'github'], ['done', 'done', 'done', 'done'], 1],
    })
  } finally {
    await store.settled(DAY)
    await rm(dir, { recursive: true, force: true })
  }
})

test('Stop ends the running summary unwritten and keeps it stopped until Start again runs it once more', async () => {
  const dir = await makeTempDir({ prefix: 'sky-review-stop-' })
  let summaryHref: string | null = null
  let summaries = 0,
    aborted = 0
  const started = Promise.withResolvers<void>()
  const store = new DayReviewStore(dir, {
    inventory: async () => ({ today: '2030-06-18', items: [], hasDay: true, summarized: false, summaryHref }),
    apply: async () => {},
    runtime: {
      status: async () => ({ pending: null, supported: true }),
      acknowledge: async () => {},
      recaps: async () => RECAPS,
      recap: async () => 'Already saved.',
      summarize: (ymd, signal) => {
        if (++summaries > 1) {
          summaryHref = '/summary.md'
          return Promise.resolve()
        }
        started.resolve()
        return new Promise<void>((_, reject) => {
          signal.addEventListener('abort', () => {
            aborted++
            reject(new Error('The operation was aborted.'))
          })
        })
      },
    },
  })
  try {
    await store.open(DAY)
    await started.promise
    const running = (await store.view(DAY)).summary.status
    const stopped = await store.stop(DAY, 'summary')
    await store.settled(DAY)
    await store.close(DAY)
    await store.open(DAY)
    await store.refresh(DAY)
    await store.settled(DAY)
    assert({
      given: 'Stop while the summary runs, then closing and reopening the review',
      should: 'abort the run, write nothing, and wait instead of starting another',
      actual: [
        running,
        stopped.summary.status,
        stopped.summary.message,
        aborted,
        (await store.view(DAY)).summary.status,
        summaries,
      ],
      expected: ['running', 'stopped', 'Stopped. Nothing was written.', 1, 'stopped', 1],
    })
    const refused = await store.stop(DAY, 'summary').then(
      () => null,
      (error: Error) => error.message,
    )
    await store.retry(DAY, 'summary')
    await store.settled(DAY)
    assert({
      given: 'Stop with nothing running, then Start again',
      should: 'refuse the stop and run the summary once more to completion',
      actual: [refused, summaries, (await store.view(DAY)).summary.status],
      expected: ['The summary is not running.', 2, 'done'],
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
