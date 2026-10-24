import { rm } from 'node:fs/promises'
import { makeTempDir } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import { DayReviewStore, type ReviewHost } from './store.ts'
import type { ReviewItem } from './types.ts'

const DAY = '2030-06-17'
const item: ReviewItem = { id: 'meeting:test', kind: 'meeting', title: 'Atlas planning' }

test('review saves skips and drafts across closing and restart, and summarizes exactly once after recaps', async () => {
  const dir = await makeTempDir({ prefix: 'sky-review-state-' })
  const calls: string[] = []
  let release!: () => void
  const recap = new Promise<void>((resolve) => {
    release = resolve
  })
  const host: ReviewHost = {
    inventory: async () => ({ today: '2030-06-18', items: [item], hasDay: true, ended: false, summaryHref: null }),
    apply: async () => {
      throw new Error('Not used')
    },
    runtime: {
      status: async () => ({ pending: null, supported: true }),
      claim: async () => null,
      acknowledge: async () => {},
      recap: async (id) => {
        calls.push(id)
        await recap
      },
      summarize: async () => {
        calls.push('summary')
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
    await resumed.answer(DAY, item.id, 'restore')
    await resumed.settled(DAY)
    assert({
      given: 'review a skipped item again',
      should: 'restore it without overwriting the saved summary',
      actual: [(await resumed.view(DAY)).items.length, calls.filter((c) => c === 'summary').length],
      expected: [1, 1],
    })
  } finally {
    release()
    await rm(dir, { recursive: true, force: true })
  }
})

test('failed recaps block summary, independent recaps finish, and retries do not repeat successful work', async () => {
  const dir = await makeTempDir({ prefix: 'sky-review-retry-' })
  let fail = true,
    summaries = 0
  const calls: string[] = []
  const host: ReviewHost = {
    inventory: async () => ({ today: '2030-06-18', items: [], hasDay: true, ended: false, summaryHref: null }),
    apply: async () => {},
    runtime: {
      status: async () => ({ pending: null, supported: true }),
      claim: async () => null,
      acknowledge: async () => {},
      recap: async (id) => {
        calls.push(id)
        if (id === 'github' && fail) throw new Error('GitHub could not be read.')
      },
      summarize: async () => {
        summaries++
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
