import { rm } from 'node:fs/promises'
import { makeTempDir } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import { DayReviewStore, type ReviewHost } from './store.ts'
import type { ReviewItem } from './types.ts'

const DAY = '2030-06-17'
const item: ReviewItem = { id: 'meeting:test', kind: 'meeting', title: 'Atlas planning' }

test('review saves skips and drafts across closing and restart, and summarizes exactly once after recaps', async () => {
  const dir = await makeTempDir({ prefix: 'sky-review-state-' })
  let summaryHref: string | null = null
  const calls: string[] = []
  let release!: () => void
  const recap = new Promise<void>((resolve) => {
    release = resolve
  })
  const host: ReviewHost = {
    inventory: async () => ({ today: '2030-06-18', items: [item], hasDay: true, summarized: false, summaryHref }),
    apply: async () => {
      throw new Error('Not used')
    },
    runtime: {
      status: async () => ({ pending: null, supported: true }),
      acknowledge: async () => {},
      recap: async (id) => {
        calls.push(id)
        await recap
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
    release()
    await store.settled(DAY)
    assert({
      given: 'closed review whose recaps finish later',
      should: 'save the skip but defer summary',
      actual: [calls, (await store.view(DAY)).paused],
      expected: [['slack', 'github', 'codex', 'claude-code'], true],
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
      expected: [[], { 'tracking:test': { duration: '7.5' } }, ['slack', 'github', 'codex', 'claude-code', 'summary']],
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
      should: 'regenerate once while keeping the completed recaps and prior choices',
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
    release()
    await rm(dir, { recursive: true, force: true })
  }
})

test('saved recaps become ready while another recap is running, and summary waits for every source', async () => {
  const dir = await makeTempDir({ prefix: 'sky-review-parallel-' })
  const slack = Promise.withResolvers<void>()
  const calls: string[] = []
  let summaryHref: string | null = null
  const store = new DayReviewStore(dir, {
    inventory: async () => ({ today: '2030-06-18', items: [], hasDay: true, summarized: false, summaryHref }),
    apply: async () => {},
    runtime: {
      status: async () => ({ pending: null, supported: true }),
      acknowledge: async () => {},
      recap: async (id) => {
        calls.push(id)
        if (id === 'slack') await slack.promise
        else return 'Already saved.'
      },
      summarize: async () => {
        calls.push('summary')
        summaryHref = '/summary.md'
      },
    },
  })
  try {
    await store.open(DAY)
    let view = await store.view(DAY)
    for (let attempt = 0; attempt < 100 && view.recaps.filter((job) => job.status === 'done').length < 3; attempt++) {
      await Bun.sleep(10)
      view = await store.view(DAY)
    }
    assert({
      given: 'Slack is still running and the other recaps already exist',
      should: 'show saved recaps as ready without waiting for Slack, and defer the summary',
      actual: [view.recaps.map((job) => [job.status, job.message ?? null]), view.summary.status, calls],
      expected: [
        [
          ['running', null],
          ['done', 'Already saved.'],
          ['done', 'Already saved.'],
          ['done', 'Already saved.'],
        ],
        'waiting',
        ['slack', 'github', 'codex', 'claude-code'],
      ],
    })
    await store.open(DAY)
    await store.refresh(DAY)
    slack.resolve()
    await store.settled(DAY)
    assert({
      given: 'the last recap finishes after reopening and polling the review',
      should: 'run the summary once without repeating any recap',
      actual: [calls, (await store.view(DAY)).summary.status],
      expected: [['slack', 'github', 'codex', 'claude-code', 'summary'], 'done'],
    })
  } finally {
    slack.resolve()
    await store.settled(DAY)
    await rm(dir, { recursive: true, force: true })
  }
})

test('failed recaps block summary, independent recaps finish, and retries do not repeat successful work', async () => {
  const dir = await makeTempDir({ prefix: 'sky-review-retry-' })
  let fail = true,
    summaries = 0
  let summaryHref: string | null = null
  const calls: string[] = []
  const host: ReviewHost = {
    inventory: async () => ({ today: '2030-06-18', items: [], hasDay: true, summarized: false, summaryHref }),
    apply: async () => {},
    runtime: {
      status: async () => ({ pending: null, supported: true }),
      acknowledge: async () => {},
      recap: async (id) => {
        calls.push(id)
        if (id === 'github' && fail) throw new Error('GitHub could not be read.')
      },
      summarize: async () => {
        summaries++
        summaryHref = '/summary.md'
      },
    },
  }
  try {
    const store = new DayReviewStore(dir, host)
    await store.open(DAY)
    await store.settled(DAY)
    assert({
      given: 'one failed source',
      should: 'keep successful recaps and wait',
      actual: [summaries, (await store.view(DAY)).recaps.map((r) => r.status)],
      expected: [0, ['done', 'error', 'done', 'done']],
    })
    fail = false
    await store.retry(DAY, 'github')
    await store.settled(DAY)
    assert({
      given: 'retry',
      should: 'run only the failed source then summarize',
      actual: [calls, summaries],
      expected: [['slack', 'github', 'codex', 'claude-code', 'github'], 1],
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
