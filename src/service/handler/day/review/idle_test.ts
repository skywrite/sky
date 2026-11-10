import { rm } from 'node:fs/promises'
import { makeTempDir } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import { ReviewIdle } from './idle.ts'

const HOUR = 3_600_000,
  MIN = 60_000,
  SEC = 1000
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

test('a closed computer waking itself through the night stays away until a key is pressed after a wake', async () => {
  const dir = await makeTempDir({ prefix: 'sky-review-idle-' })
  try {
    const idle = new ReviewIdle(dir)
    // Evening: at the keys two seconds ago, on a computer awake since the morning.
    const evening = 100 * HOUR
    await idle.sample(evening, 2 * SEC, DAY, DAY, 5, evening - 12 * HOUR)
    // Night: a background wake every fifteen minutes. The idle timer stops while the computer sleeps,
    // so at each wake it reads only the seconds spent awake since that last key press.
    let awake = 5 * SEC
    for (let wake = evening + 15 * MIN; wake < evening + 10 * HOUR; wake += 15 * MIN) {
      awake += 4 * SEC
      await idle.sample(wake + 4 * SEC, awake, DAY, TODAY, 5, wake)
    }
    // A notification lights the screen for twenty seconds with nobody there.
    const lit = evening + 10 * HOUR
    await idle.sample(lit + 20 * SEC, awake + 20 * SEC, DAY, TODAY, 5, lit)
    // Morning: the key press that wakes the computer is stamped with the wake itself, and a reading
    // taken before the wake is stamped has no wake time at all.
    const morning = lit + 5 * MIN
    await idle.sample(morning + 1500, 1500, DAY, TODAY, 5, morning)
    await idle.sample(morning + 2 * SEC, 2 * SEC, DAY, TODAY, 5, null)
    const asleep = await idle.status()
    // The next key press, eight seconds after the wake.
    const back = await idle.sample(morning + 15 * SEC, 7 * SEC, DAY, TODAY, 5, morning)
    assert({
      given: 'ten hours of background wakes, a notification, and the wake itself, then a key pressed after the wake',
      should: 'count the whole night as away and offer the review at that key press',
      actual: [asleep, back, await idle.status()],
      expected: [
        { pending: null, supported: false },
        { awayMs: 10 * HOUR + 5 * MIN + 10 * SEC, offered: DAY },
        { pending: DAY, supported: true },
      ],
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('restarts while the computer sleeps keep the hours away already seen', async () => {
  const dir = await makeTempDir({ prefix: 'sky-review-idle-' })
  try {
    const evening = 100 * HOUR
    await new ReviewIdle(dir).sample(evening, 2 * SEC, DAY, DAY, 5, evening - 12 * HOUR)
    // The service restarts inside a background wake six hours in, and again before morning.
    const night = evening + 6 * HOUR
    await new ReviewIdle(dir).sample(night + 4 * SEC, 40 * SEC, DAY, TODAY, 5, night)
    const restarted = new ReviewIdle(dir)
    const morning = evening + 10 * HOUR
    const back = await restarted.sample(morning + 15 * SEC, 7 * SEC, DAY, TODAY, 5, morning)
    assert({
      given: 'two restarts during the night, the first having seen six hours away',
      should: 'offer the review at the first key press after the morning wake',
      actual: [back?.offered, (await restarted.status()).pending],
      expected: [DAY, DAY],
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
