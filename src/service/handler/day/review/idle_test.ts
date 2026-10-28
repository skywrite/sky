import { rm } from 'node:fs/promises'
import { makeTempDir } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import { ReviewIdle } from './idle.ts'

const HOUR = 3_600_000
const DAY = '2030-06-17',
  TODAY = '2030-06-18'

test('review waits for a real return across dates and stays offered until acknowledged', async () => {
  const dir = await makeTempDir({ prefix: 'sky-review-idle-' })
  try {
    const idle = new ReviewIdle(dir)
    await idle.sample(0, 0, DAY, DAY, 5)
    await idle.sample(6 * HOUR, 6 * HOUR, DAY, TODAY, 5)
    assert({
      given: 'a sleeping computer after midnight',
      should: 'wait for input',
      actual: (await idle.status()).pending,
      expected: null,
    })
    await idle.sample(6 * HOUR + 1000, 0, DAY, TODAY, 5)
    const tabs = await Promise.all([idle.status(), idle.status()])
    await idle.acknowledge(DAY)
    assert({
      given: 'two browser tabs on returning, then a choice in one of them',
      should: 'offer the old day to both until the choice',
      actual: [tabs.map((tab) => tab.pending), (await idle.status()).pending],
      expected: [[DAY, DAY], null],
    })
    await idle.sample(12 * HOUR, 0, DAY, TODAY, 5)
    assert({
      given: 'another idle gap on the same unstarted day',
      should: 'respect dismissal',
      actual: (await idle.status()).pending,
      expected: null,
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('idle uses configured hours, rejects same-date naps and unsupported samples, and survives sleep', async () => {
  const dir = await makeTempDir({ prefix: 'sky-review-idle-' })
  try {
    const idle = new ReviewIdle(dir)
    await idle.sample(0, 0, DAY, DAY, 2)
    await idle.sample(3 * HOUR, 0, DAY, DAY, 2)
    await idle.sample(4 * HOUR, 0, DAY, TODAY, 2)
    await idle.sample(6 * HOUR, null, DAY, TODAY, 2)
    assert({
      given: 'a same-day nap, short break, and unsupported sample',
      should: 'not prompt',
      actual: await idle.status(),
      expected: { pending: null, supported: false },
    })
    await idle.sample(7 * HOUR, 0, DAY, TODAY, 2)
    assert({
      given: 'sampling suspended with the computer',
      should: 'recognize the return',
      actual: (await idle.status()).pending,
      expected: DAY,
    })
    await idle.sample(7 * HOUR + 1000, 0, DAY, TODAY, 0)
    assert({
      given: 'automatic prompting disabled',
      should: 'clear a pending popup',
      actual: (await idle.status()).pending,
      expected: null,
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('restart needs observed idle evidence instead of treating service downtime as sleep', async () => {
  const dir = await makeTempDir({ prefix: 'sky-review-idle-' })
  try {
    await new ReviewIdle(dir).sample(0, 0, DAY, DAY, 5)
    const restarted = new ReviewIdle(dir)
    await restarted.sample(6 * HOUR, 0, DAY, TODAY, 5)
    assert({
      given: 'service stopped while the computer may have been active',
      should: 'not infer idle from downtime',
      actual: (await restarted.status()).pending,
      expected: null,
    })
    await restarted.sample(12 * HOUR, 6 * HOUR, DAY, TODAY, 5)
    const afterSleep = new ReviewIdle(dir)
    await afterSleep.sample(12 * HOUR + 1000, 0, DAY, TODAY, 5)
    assert({
      given: 'idle observed before a restart',
      should: 'remember the return',
      actual: (await afterSleep.status()).pending,
      expected: DAY,
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
