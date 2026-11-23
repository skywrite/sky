import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import type { CommandEntry, CommandsManifest } from '#commands/all/cli/_commandsManifest.ts'
import { writeJson } from '#lib/jobs/files.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import {
  discoverDayRecaps,
  latestStartedDay,
  parseAppFilter,
  type RecapCommandSpec,
  runRecapBackfill,
} from './backfill.ts'

async function withStateDir<T>(fn: (stateDir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), 'sky-recap-backfill-'))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const manifestEntry = (
  name: string,
  flags: CommandEntry['flags'] = [{ name: 'day', kind: 'arg', type: 'plainDate', description: 'Day' }],
): CommandEntry => ({
  name,
  file: `/commands/${name}.ts`,
  description: `Run ${name}`,
  flags,
  aiChatTool: false,
})

test('discoverDayRecaps follows local > global > core precedence and excludes non-day recaps', () => {
  const manifest: CommandsManifest = {
    version: 2,
    commands: {
      core: [
        manifestEntry('recap:coding', [
          { name: 'day', kind: 'arg', type: 'plainDate', description: 'Day' },
          { name: 'no-editor', kind: 'flag', type: 'bool', description: 'Skip editor' },
        ]),
        manifestEntry('recap:notes', [{ name: 'day', kind: 'arg', type: 'plainDate', description: 'Day' }]),
        manifestEntry('recap:backfill', [{ name: 'days', kind: 'flag', type: 'number', description: 'Days' }]),
        manifestEntry('recap:notes:weekly', [{ name: 'day', kind: 'arg', type: 'plainDate', description: 'Day' }]),
        manifestEntry('day:start', [{ name: 'day', kind: 'arg', type: 'plainDate', description: 'Day' }]),
      ],
      global: [
        manifestEntry('recap:notes', [
          { name: 'day', kind: 'arg', type: 'plainDate', description: 'Day' },
          { name: 'noEditor', kind: 'flag', type: 'bool', description: 'Skip editor' },
        ]),
        manifestEntry('recap:journal', [{ name: 'day', kind: 'arg', type: 'plainDate', description: 'Day' }]),
      ],
      local: [
        manifestEntry('recap:notes', [{ name: 'day', kind: 'arg', type: 'plainDate', description: 'Day' }]),
        manifestEntry('recap:activity', [
          { name: 'day', kind: 'arg', type: 'plainDate', description: 'Day' },
          { name: 'no-editor', kind: 'flag', type: 'bool', description: 'Skip editor' },
        ]),
      ],
    },
  }

  assert({
    given: 'a manifest with core, global, local, nested, and non-day recap commands',
    should: 'return only single-segment day recaps, with local overriding global/core and noEditor detected accurately',
    actual: discoverDayRecaps(manifest),
    expected: [
      { app: 'activity', command: 'recap:activity', supportsNoEditor: true },
      { app: 'coding', command: 'recap:coding', supportsNoEditor: true },
      { app: 'journal', command: 'recap:journal', supportsNoEditor: false },
      { app: 'notes', command: 'recap:notes', supportsNoEditor: false },
    ],
  })
})

test('parseAppFilter normalizes commas, whitespace, duplicates, and recap: prefixes', () => {
  assert({
    given: 'a mixed comma-separated app string',
    should: 'strip recap: prefixes, trim, and deduplicate while preserving order',
    actual: parseAppFilter(' recap:coding, notes, coding , , recap:journal '),
    expected: ['coding', 'notes', 'journal'],
  })
  assert({
    given: 'an empty or blank filter',
    should: 'return undefined',
    actual: [parseAppFilter(undefined), parseAppFilter(' , ')],
    expected: [undefined, undefined],
  })
})

test('latestStartedDay handles normal mornings, pre-start nights, travel gaps, and unstarted notebooks', async () => {
  const today = new PlainDate('2025-03-15')

  const normal = await latestStartedDay(today, 5, async (d) => d.ymd === '2025-03-15')
  const preStart = await latestStartedDay(today, 5, async (d) => d.ymd === '2025-03-14')
  const travelGap = await latestStartedDay(today, 5, async (d) => d.ymd === '2025-03-15' || d.ymd === '2025-03-10')
  const none = await latestStartedDay(today, 5, async () => false)

  assert({
    given: 'different day-start histories',
    should: 'find the newest started day or null when none started in range',
    actual: [normal?.ymd ?? null, preStart?.ymd ?? null, travelGap?.ymd ?? null, none?.ymd ?? null],
    expected: ['2025-03-15', '2025-03-14', '2025-03-15', null],
  })
})

test('runRecapBackfill backfills across travel gaps, skips existing, caches empty days, and honors force', async () => {
  await withStateDir(async (stateDir) => {
    const today = new PlainDate('2025-03-15')
    const recaps: RecapCommandSpec[] = [
      { app: 'coding', command: 'recap:coding', supportsNoEditor: true },
      { app: 'notes', command: 'recap:notes', supportsNoEditor: false },
    ]
    // Travel gap: 03-12, 03-13, 03-14 were never started; 03-15 started today.
    const startedDays = new Set(['2025-03-11', '2025-03-15'])
    const existing = new Set(['2025-03-12:coding'])
    const runs: string[] = []

    const first = await runRecapBackfill({
      recaps,
      today,
      days: 3,
      stateDir,
      started: async (d) => startedDays.has(d.ymd),
      hasRecap: async (d, app) => existing.has(`${d.ymd}:${app}`),
      runRecap: async (spec, day) => {
        const key = `${day.ymd}:${spec.app}`
        runs.push(key)
        // coding produces a file on 03-13 and 03-14; notes has no activity on any day.
        if (spec.app === 'coding') existing.add(key)
        return { ok: true }
      },
    })

    assert({
      given: '3 missed days across a travel gap with one existing recap and one quiet app',
      should: 'backfill missing files, cache confirmed-empty runs, and report acted',
      actual: {
        outcome: first.outcome,
        daysChecked: first.daysChecked,
        recapped: first.recapped,
        empty: first.empty,
        skippedExisting: first.skippedExisting,
        skippedEmpty: first.skippedEmpty,
        errors: first.errors,
        runs,
      },
      expected: {
        outcome: 'acted',
        daysChecked: ['2025-03-12', '2025-03-13', '2025-03-14'],
        recapped: [
          { day: '2025-03-13', app: 'coding' },
          { day: '2025-03-14', app: 'coding' },
        ],
        empty: [
          { day: '2025-03-12', app: 'notes' },
          { day: '2025-03-13', app: 'notes' },
          { day: '2025-03-14', app: 'notes' },
        ],
        skippedExisting: 1,
        skippedEmpty: 0,
        errors: [],
        runs: ['2025-03-12:notes', '2025-03-13:coding', '2025-03-13:notes', '2025-03-14:coding', '2025-03-14:notes'],
      },
    })

    // Second pass: everything is either on disk or cached empty -> quiet nothing pass, zero runs.
    const secondRuns: string[] = []
    const second = await runRecapBackfill({
      recaps,
      today,
      days: 3,
      stateDir,
      started: async (d) => startedDays.has(d.ymd),
      hasRecap: async (d, app) => existing.has(`${d.ymd}:${app}`),
      runRecap: async (spec, day) => {
        secondRuns.push(`${day.ymd}:${spec.app}`)
        return { ok: true }
      },
    })

    assert({
      given: 'a repeat pass after empty runs were cached',
      should: 'skip both existing and cached-empty entries and report nothing',
      actual: {
        outcome: second.outcome,
        skippedExisting: second.skippedExisting,
        skippedEmpty: second.skippedEmpty,
        runs: secondRuns,
      },
      expected: {
        outcome: 'nothing',
        skippedExisting: 3,
        skippedEmpty: 3,
        runs: [],
      },
    })

    // Forced pass: re-checks cached-empty days and removes a key from cache if it now creates a file.
    const forcedRuns: string[] = []
    const forced = await runRecapBackfill({
      recaps,
      today,
      days: 3,
      force: true,
      stateDir,
      started: async (d) => startedDays.has(d.ymd),
      hasRecap: async (d, app) => existing.has(`${d.ymd}:${app}`),
      runRecap: async (spec, day) => {
        const key = `${day.ymd}:${spec.app}`
        forcedRuns.push(key)
        if (key === '2025-03-14:notes') existing.add(key)
        return { ok: true }
      },
    })
    const cacheAfterForce = JSON.parse(await readFile(path.join(stateDir, 'backfill.json'), 'utf8')) as {
      empty: Record<string, string>
    }

    assert({
      given: 'a forced pass when one previously empty day now has activity',
      should: 're-run cached-empty entries, create the new recap, and drop it from backfill.json',
      actual: {
        outcome: forced.outcome,
        recapped: forced.recapped,
        forcedRuns,
        cachedKeys: Object.keys(cacheAfterForce.empty).sort(),
      },
      expected: {
        outcome: 'acted',
        recapped: [{ day: '2025-03-14', app: 'notes' }],
        forcedRuns: ['2025-03-12:notes', '2025-03-13:notes', '2025-03-14:notes'],
        cachedKeys: ['2025-03-12:notes', '2025-03-13:notes'],
      },
    })
  })
})

test('runRecapBackfill skips an in-progress yesterday when today has not started yet', async () => {
  await withStateDir(async (stateDir) => {
    const today = new PlainDate('2025-03-15')
    const recaps: RecapCommandSpec[] = [{ app: 'coding', command: 'recap:coding', supportsNoEditor: true }]
    const runs: string[] = []

    const result = await runRecapBackfill({
      recaps,
      today,
      days: 3,
      stateDir,
      // Past midnight: 03-14 started, 03-15 has not started yet.
      started: async (d) => d.ymd === '2025-03-14',
      hasRecap: async () => false,
      runRecap: async (spec, day) => {
        runs.push(`${day.ymd}:${spec.app}`)
        return { ok: true }
      },
    })

    assert({
      given: 'today has not started yet while yesterday has',
      should: 'backfill only days strictly before yesterday and leave yesterday untouched',
      actual: { daysChecked: result.daysChecked, runs },
      expected: {
        daysChecked: ['2025-03-12', '2025-03-13'],
        runs: ['2025-03-12:coding', '2025-03-13:coding'],
      },
    })
  })
})

test('runRecapBackfill never caches failed runs and retries them automatically on the next pass', async () => {
  await withStateDir(async (stateDir) => {
    const today = new PlainDate('2025-03-15')
    const recaps: RecapCommandSpec[] = [
      { app: 'coding', command: 'recap:coding', supportsNoEditor: true },
      { app: 'notes', command: 'recap:notes', supportsNoEditor: false },
    ]
    const existing = new Set<string>()
    let notesShouldFail = true

    const first = await runRecapBackfill({
      recaps,
      today,
      days: 1,
      stateDir,
      started: async (d) => d.ymd === '2025-03-15',
      hasRecap: async (d, app) => existing.has(`${d.ymd}:${app}`),
      runRecap: async (spec, day) => {
        if (spec.app === 'notes' && notesShouldFail) {
          return { ok: false, message: 'Network unreachable' }
        }
        existing.add(`${day.ymd}:${spec.app}`)
        return { ok: true }
      },
    })

    notesShouldFail = false
    const second = await runRecapBackfill({
      recaps,
      today,
      days: 1,
      stateDir,
      started: async (d) => d.ymd === '2025-03-15',
      hasRecap: async (d, app) => existing.has(`${d.ymd}:${app}`),
      runRecap: async (spec, day) => {
        existing.add(`${day.ymd}:${spec.app}`)
        return { ok: true }
      },
    })

    assert({
      given: 'one recap fails while another succeeds, then the failure resolves',
      should: 'continue other apps, report failed without caching the failure, and succeed on retry',
      actual: {
        firstOutcome: first.outcome,
        firstRecapped: first.recapped,
        firstErrors: first.errors,
        secondOutcome: second.outcome,
        secondRecapped: second.recapped,
        secondSkippedExisting: second.skippedExisting,
      },
      expected: {
        firstOutcome: 'failed',
        firstRecapped: [{ day: '2025-03-14', app: 'coding' }],
        firstErrors: [{ day: '2025-03-14', app: 'notes', message: 'Network unreachable' }],
        secondOutcome: 'acted',
        secondRecapped: [{ day: '2025-03-14', app: 'notes' }],
        secondSkippedExisting: 1,
      },
    })
  })
})

test('runRecapBackfill dryRun lists planned work without invoking recaps or writing state', async () => {
  await withStateDir(async (stateDir) => {
    const today = new PlainDate('2025-03-15')
    const recaps: RecapCommandSpec[] = [{ app: 'coding', command: 'recap:coding', supportsNoEditor: true }]
    let invoked = 0

    const result = await runRecapBackfill({
      recaps,
      today,
      days: 2,
      dryRun: true,
      stateDir,
      started: async (d) => d.ymd === '2025-03-15',
      hasRecap: async () => false,
      runRecap: async () => {
        invoked++
        return { ok: true }
      },
    })

    let cacheExists = true
    try {
      await readFile(path.join(stateDir, 'backfill.json'), 'utf8')
    } catch {
      cacheExists = false
    }

    assert({
      given: 'dryRun: true',
      should: 'report planned recaps with outcome nothing and perform zero runs or cache writes',
      actual: { outcome: result.outcome, planned: result.planned, invoked, cacheExists },
      expected: {
        outcome: 'nothing',
        planned: [
          { day: '2025-03-13', app: 'coding' },
          { day: '2025-03-14', app: 'coding' },
        ],
        invoked: 0,
        cacheExists: false,
      },
    })
  })
})

test('runRecapBackfill prunes entries older than 60 days and respects AbortSignal', async () => {
  await withStateDir(async (stateDir) => {
    const today = new PlainDate('2025-03-15')
    await writeJson(
      path.join(stateDir, 'backfill.json'),
      {
        version: 1,
        empty: {
          '2025-01-01:coding': '2025-01-02',
          '2025-03-10:coding': '2025-03-11',
        },
      },
      2,
    )

    const controller = new AbortController()
    const runs: string[] = []
    const result = await runRecapBackfill({
      recaps: [
        { app: 'coding', command: 'recap:coding', supportsNoEditor: true },
        { app: 'notes', command: 'recap:notes', supportsNoEditor: false },
      ],
      today,
      days: 2,
      stateDir,
      signal: controller.signal,
      started: async (d) => d.ymd === '2025-03-15',
      hasRecap: async () => false,
      runRecap: async (spec, day) => {
        runs.push(`${day.ymd}:${spec.app}`)
        controller.abort()
        return { ok: true }
      },
    })

    const cache = JSON.parse(await readFile(path.join(stateDir, 'backfill.json'), 'utf8')) as {
      empty: Record<string, string>
    }

    assert({
      given: 'an abort during the first recap and a 60+ day old cache entry',
      should: 'stop immediately without caching the aborted run and prune expired cache keys',
      actual: {
        outcome: result.outcome,
        stopped: result.stopped,
        runs,
        cachedKeys: Object.keys(cache.empty).sort(),
      },
      expected: {
        outcome: 'failed',
        stopped: true,
        runs: ['2025-03-13:coding'],
        cachedKeys: ['2025-03-10:coding'],
      },
    })
  })
})

test('runRecapBackfill validates --days bounds and --apps names', async () => {
  await withStateDir(async (stateDir) => {
    const today = new PlainDate('2025-03-15')
    const recaps: RecapCommandSpec[] = [{ app: 'coding', command: 'recap:coding', supportsNoEditor: true }]
    const base = {
      recaps,
      today,
      stateDir,
      started: async () => true,
      hasRecap: async () => false,
      runRecap: async () => ({ ok: true }),
    }

    let badDaysError = ''
    try {
      await runRecapBackfill({ ...base, days: 31 })
    } catch (err) {
      badDaysError = (err as Error).message
    }

    let badAppError = ''
    try {
      await runRecapBackfill({ ...base, apps: ['missing'] })
    } catch (err) {
      badAppError = (err as Error).message
    }

    assert({
      given: 'out-of-range days and an unknown app name',
      should: 'reject both with clear error messages',
      actual: [badDaysError.includes('between 1 and 30'), badAppError.includes('Unknown recap app(s): missing')],
      expected: [true, true],
    })
  })
})
