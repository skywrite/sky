import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { assert, test } from '#test'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import AutomationStateStore from './state.ts'
import { parseTrigger } from './trigger.ts'

const EVERY = parseTrigger({ every: '5m' })
const AT_NOTEBOOK = parseTrigger({ at: '09:00' })

async function tempFile(contents?: string): Promise<{ dir: string; file: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'automation-state-test-'))
  const file = path.join(dir, 'automations.json')
  if (contents !== undefined) await writeFile(file, contents)
  return { dir, file }
}

test('AutomationStateStore - a missing file is an empty history, not a failure', async () => {
  const { dir, file } = await tempFile()

  try {
    const store = await AutomationStateStore.load(file)

    assert({
      given: 'a state file that does not exist yet',
      should: 'load empty with no error',
      actual: { names: store.names(), loadError: store.loadError, last: store.lastRunFor('anything', EVERY) },
      expected: { names: [], loadError: undefined, last: undefined },
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('AutomationStateStore - a run round-trips through the file', async () => {
  const { dir, file } = await tempFile()

  try {
    const store = await AutomationStateStore.load(file)
    store.record('market-open', {
      utc: new PlainDateTime('13:30', '2026-08-24'),
      clock: new PlainDateTime('09:30', '2026-08-24'),
      outcome: 'acted',
      target: 'EVERY-WEEKDAY 09:30',
      lateMinutes: 0,
      message: 'posted the open',
    })
    await store.save()

    const reloaded = await AutomationStateStore.load(file)

    assert({
      given: 'a recorded run, saved and loaded again',
      should: 'preserve every field',
      actual: reloaded.last('market-open'),
      expected: {
        utc: '2026-08-24 13:30',
        clock: '2026-08-24 09:30',
        outcome: 'acted',
        target: 'EVERY-WEEKDAY 09:30',
        lateMinutes: 0,
        message: 'posted the open',
      },
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('AutomationStateStore - the stamp handed back follows the trigger kind', async () => {
  // The whole point: an elapsed-time trigger must never be compared against a
  // notebook-frame stamp, which would read 09:33 against a 13:35 UTC now and
  // turn two minutes into four hours.
  const { dir, file } = await tempFile()

  try {
    const store = await AutomationStateStore.load(file)
    store.record('email-fetch', {
      utc: new PlainDateTime('13:33', '2026-08-24'),
      clock: new PlainDateTime('09:33', '2026-08-24'),
      outcome: 'nothing',
    })

    assert({
      given: 'one run recorded in both frames',
      should: 'give every: the absolute stamp and at: the charter clock',
      actual: [store.lastRunFor('email-fetch', EVERY)?.time, store.lastRunFor('email-fetch', AT_NOTEBOOK)?.time],
      expected: ['13:33', '09:33'],
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('AutomationStateStore - an extended-hour clock survives the round trip', async () => {
  const { dir, file } = await tempFile()

  try {
    const store = await AutomationStateStore.load(file)
    store.record('late-night', {
      utc: new PlainDateTime('06:30', '2026-08-22'),
      clock: new PlainDateTime('25:30', '2026-08-21'), // Friday's late night
      outcome: 'acted',
    })
    await store.save()

    const reloaded = await AutomationStateStore.load(file)
    const clock = reloaded.lastRunFor('late-night', AT_NOTEBOOK)

    assert({
      given: 'a clock stamp of 25:30',
      should: 'come back as hour 25 on the day that owns the late night',
      actual: [clock?.date, clock?.time],
      expected: ['2026-08-21', '25:30'],
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('AutomationStateStore - unusable state starts empty and says why', async () => {
  const fixtures = [
    { label: 'corrupt JSON', contents: '{ this is not json' },
    { label: 'a future version', contents: JSON.stringify({ version: 99, runs: {} }) },
  ]

  for (const fixture of fixtures) {
    const { dir, file } = await tempFile(fixture.contents)

    try {
      const store = await AutomationStateStore.load(file)

      assert({
        given: fixture.label,
        should: 'load empty and report the problem rather than throwing',
        actual: { names: store.names(), reported: Boolean(store.loadError) },
        expected: { names: [], reported: true },
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }
})

test('AutomationStateStore - a corrupt stamp reads as never run', async () => {
  const contents = JSON.stringify({
    version: 1,
    runs: { broken: { utc: 'not-a-time', clock: 'also-not', outcome: 'acted' } },
  })
  const { dir, file } = await tempFile(contents)

  try {
    const store = await AutomationStateStore.load(file)

    assert({
      given: 'a stored run whose stamps cannot be parsed',
      should: 'read as never run instead of wedging the tick',
      actual: [store.lastRunFor('broken', EVERY), store.last('broken')?.outcome],
      expected: [undefined, 'acted'],
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('AutomationStateStore - the ledger keeps runs newest first, through the file', async () => {
  const { dir, file } = await tempFile()

  try {
    const store = await AutomationStateStore.load(file)
    store.record('brief', {
      utc: new PlainDateTime('07:01', '2026-08-24'),
      clock: new PlainDateTime('07:01', '2026-08-24'),
      outcome: 'nothing',
    })
    store.record('brief', {
      utc: new PlainDateTime('07:02', '2026-08-25'),
      clock: new PlainDateTime('07:02', '2026-08-25'),
      outcome: 'acted',
    })
    await store.save()

    const reloaded = await AutomationStateStore.load(file)

    assert({
      given: 'two recorded runs, saved and loaded again',
      should: 'list both, newest first, agreeing with last()',
      actual: [reloaded.runsFor('brief').map((run) => run.clock), reloaded.last('brief')?.clock],
      expected: [['2026-08-25 07:02', '2026-08-24 07:01'], '2026-08-25 07:02'],
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('AutomationStateStore - the ledger is bounded, dropping the oldest', async () => {
  const { dir, file } = await tempFile()

  try {
    const store = await AutomationStateStore.load(file)
    for (let i = 0; i < 55; i++) {
      const stamp = new PlainDateTime(
        `${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}`,
        '2026-08-24',
      )
      store.record('busy', { utc: stamp, clock: stamp, outcome: 'nothing' })
    }

    const runs = store.runsFor('busy')
    assert({
      given: '55 recorded runs against a 50-run ledger',
      should: 'keep the newest 50',
      actual: [runs.length, runs[0]?.clock, runs.at(-1)?.clock],
      expected: [50, '2026-08-24 00:54', '2026-08-24 00:05'],
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('AutomationStateStore - a pre-ledger file reads as an empty ledger', async () => {
  const contents = JSON.stringify({
    version: 1,
    runs: { 'old-timer': { utc: '2026-08-24 10:00', clock: '2026-08-24 10:00', outcome: 'acted' } },
  })
  const { dir, file } = await tempFile(contents)

  try {
    const store = await AutomationStateStore.load(file)

    assert({
      given: 'a state file written before the ledger existed',
      should: 'keep the last run and answer no history',
      actual: [store.last('old-timer')?.outcome, store.runsFor('old-timer')],
      expected: ['acted', []],
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('AutomationStateStore - saving leaves no temporary file behind', async () => {
  const { dir, file } = await tempFile()

  try {
    const store = await AutomationStateStore.load(file)
    store.record('x', {
      utc: new PlainDateTime('10:00', '2026-08-24'),
      clock: new PlainDateTime('10:00', '2026-08-24'),
      outcome: 'nothing',
    })
    await store.save()

    assert({
      given: 'a completed save',
      should: 'leave only the state file in place',
      actual: (await readdir(dir)).sort(),
      expected: ['automations.json'],
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
