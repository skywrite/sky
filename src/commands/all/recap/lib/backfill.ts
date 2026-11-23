import * as path from 'node:path'
import type { CommandEntry, CommandsManifest } from '#commands/all/cli/_commandsManifest.ts'
import { readJson, withProcessLock, writeJson } from '#lib/jobs/files.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'

export const DEFAULT_BACKFILL_DAYS = 5
export const MIN_BACKFILL_DAYS = 1
export const MAX_BACKFILL_DAYS = 30
export const EMPTY_CACHE_RETENTION_DAYS = 60

const EMPTY_CACHE_VERSION = 1

export interface RecapCommandSpec {
  app: string
  command: string
  supportsNoEditor: boolean
}

export interface BackfillEntry {
  day: string
  app: string
}

export interface BackfillError extends BackfillEntry {
  message: string
}

export interface BackfillResult {
  outcome: 'acted' | 'nothing' | 'failed'
  daysChecked: string[]
  recapped: BackfillEntry[]
  empty: BackfillEntry[]
  planned: BackfillEntry[]
  skippedExisting: number
  skippedEmpty: number
  errors: BackfillError[]
  stopped?: boolean
}

export interface RecapRunOutcome {
  ok: boolean
  message?: string
}

export interface BackfillOptions {
  recaps: readonly RecapCommandSpec[]
  today: PlainDate
  days?: number
  apps?: readonly string[]
  dryRun?: boolean
  force?: boolean
  stateDir: string
  started: (day: PlainDate) => Promise<boolean>
  hasRecap: (day: PlainDate, app: string) => Promise<boolean>
  runRecap: (spec: RecapCommandSpec, day: PlainDate) => Promise<RecapRunOutcome>
  signal?: AbortSignal
  log?: (message: string) => void
}

interface BackfillCacheFile {
  version: number
  /** `${YYYY-MM-DD}:${app}` -> YYYY-MM-DD when the recap succeeded with no file written. */
  empty: Record<string, string>
}

function isValidYmd(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  try {
    return new PlainDate(value).ymd === value
  } catch {
    return false
  }
}

function parseCacheEntries(
  raw: BackfillCacheFile | null | undefined,
  cutoffYmd: string,
): { empty: Record<string, string>; pruned: boolean } {
  const empty: Record<string, string> = {}
  let pruned = false
  if (!raw || typeof raw !== 'object' || !raw.empty || typeof raw.empty !== 'object') {
    return { empty, pruned }
  }
  for (const [key, checkedAt] of Object.entries(raw.empty)) {
    const colon = key.indexOf(':')
    const ymd = colon === 10 ? key.slice(0, 10) : ''
    const app = colon === 10 ? key.slice(11) : ''
    if (!app || !isValidYmd(ymd) || !isValidYmd(checkedAt) || ymd < cutoffYmd) {
      pruned = true
      continue
    }
    empty[key] = checkedAt
  }
  return { empty, pruned }
}

async function readCacheSafely(cachePath: string): Promise<BackfillCacheFile | null> {
  try {
    return await readJson<BackfillCacheFile>(cachePath)
  } catch {
    return null
  }
}

/**
 * Every installed per-day `recap:<app>` command that accepts a `day` date parameter.
 * Precedence matches command dispatch: local > global > core.
 */
export function discoverDayRecaps(manifest: CommandsManifest): RecapCommandSpec[] {
  const commands = new Map<string, CommandEntry>()
  for (const command of [...manifest.commands.core, ...manifest.commands.global, ...manifest.commands.local]) {
    commands.set(command.name, command)
  }
  return [...commands.values()]
    .filter(
      (command) =>
        /^recap:[^:]+$/.test(command.name) &&
        command.flags.some((flag) => flag.name === 'day' && flag.type === 'plainDate'),
    )
    .map((command) => ({
      app: command.name.slice('recap:'.length),
      command: command.name,
      supportsNoEditor: command.flags.some(
        (flag) => (flag.name === 'noEditor' || flag.name === 'no-editor') && flag.type === 'bool',
      ),
    }))
    .sort((a, b) => a.app.localeCompare(b.app))
}

/** Parse a comma-separated `--apps` list, accepting either `github` or `recap:github`. */
export function parseAppFilter(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined
  const seen = new Set<string>()
  const apps: string[] = []
  for (const part of raw.split(',')) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const app = trimmed.startsWith('recap:') ? trimmed.slice('recap:'.length) : trimmed
    if (app && !seen.has(app)) {
      seen.add(app)
      apps.push(app)
    }
  }
  return apps.length > 0 ? apps : undefined
}

/**
 * The newest notebook day on or before `today` that has a `started:` stamp.
 * Any day strictly before it is finished even across multi-day travel gaps where
 * intermediate days were never started.
 */
export async function latestStartedDay(
  today: PlainDate,
  lookbackDays: number,
  started: (day: PlainDate) => Promise<boolean>,
): Promise<PlainDate | null> {
  for (let back = 0; back <= lookbackDays; back++) {
    const candidate = today.addDays(-back)
    if (await started(candidate)) return candidate
  }
  return null
}

/** Backfill missing day recaps over recent finished days, skipping confirmed-empty runs. */
export async function runRecapBackfill(options: BackfillOptions): Promise<BackfillResult> {
  const days = options.days ?? DEFAULT_BACKFILL_DAYS
  if (!Number.isInteger(days) || days < MIN_BACKFILL_DAYS || days > MAX_BACKFILL_DAYS) {
    throw new Error(`--days must be a whole number between ${MIN_BACKFILL_DAYS} and ${MAX_BACKFILL_DAYS}.`)
  }

  let selectedRecaps = [...options.recaps]
  if (options.apps && options.apps.length > 0) {
    const available = new Set(options.recaps.map((spec) => spec.app))
    const unknown = options.apps.filter((app) => !available.has(app))
    if (unknown.length > 0) {
      const knownList = [...available].sort().join(', ') || 'none'
      throw new Error(`Unknown recap app(s): ${unknown.join(', ')}. Installed: ${knownList}.`)
    }
    const wanted = new Set(options.apps)
    selectedRecaps = selectedRecaps.filter((spec) => wanted.has(spec.app))
  }

  const latestStarted = await latestStartedDay(options.today, days, options.started)
  const candidateDays: PlainDate[] = []
  if (latestStarted) {
    for (let back = days; back >= 1; back--) {
      const candidate = options.today.addDays(-back)
      if (PlainDate.compare(candidate, latestStarted) < 0) candidateDays.push(candidate)
    }
  }

  const daysChecked = candidateDays.map((day) => day.ymd)
  const recapped: BackfillEntry[] = []
  const empty: BackfillEntry[] = []
  const planned: BackfillEntry[] = []
  const errors: BackfillError[] = []
  let skippedExisting = 0
  let skippedEmpty = 0
  let stopped = false

  if (candidateDays.length === 0 || selectedRecaps.length === 0) {
    return {
      outcome: 'nothing',
      daysChecked,
      recapped,
      empty,
      planned,
      skippedExisting,
      skippedEmpty,
      errors,
    }
  }

  const cachePath = path.join(options.stateDir, 'backfill.json')
  const lockPath = path.join(options.stateDir, 'backfill.lock')
  const cutoffYmd = options.today.addDays(-EMPTY_CACHE_RETENTION_DAYS).ymd

  const initial = parseCacheEntries(await readCacheSafely(cachePath), cutoffYmd)
  const emptyMap = initial.empty
  let cacheNeedsPrune = initial.pruned
  const staleKeys: string[] = []

  const mutateCache = async (changes: { set?: Record<string, string>; remove?: string[] }) => {
    await withProcessLock(lockPath, async () => {
      const current = parseCacheEntries(await readCacheSafely(cachePath), cutoffYmd).empty
      for (const key of changes.remove ?? []) delete current[key]
      for (const [key, value] of Object.entries(changes.set ?? {})) current[key] = value
      await writeJson(cachePath, { version: EMPTY_CACHE_VERSION, empty: current }, 2)
    })
    cacheNeedsPrune = false
  }

  for (const day of candidateDays) {
    if (options.signal?.aborted) {
      stopped = true
      break
    }

    for (const spec of selectedRecaps) {
      if (options.signal?.aborted) {
        stopped = true
        break
      }

      const key = `${day.ymd}:${spec.app}`
      if (await options.hasRecap(day, spec.app)) {
        skippedExisting++
        if (key in emptyMap) {
          delete emptyMap[key]
          staleKeys.push(key)
        }
        continue
      }

      if (!options.force && key in emptyMap) {
        skippedEmpty++
        continue
      }

      if (options.dryRun) {
        planned.push({ day: day.ymd, app: spec.app })
        options.log?.(`[dry-run] Would run ${spec.command} ${day.ymd}`)
        continue
      }

      options.log?.(`Backfilling ${spec.command} for ${day.ymd}...`)
      let outcome: RecapRunOutcome
      try {
        outcome = await options.runRecap(spec, day)
      } catch (err) {
        if (options.signal?.aborted) {
          stopped = true
          break
        }
        const message = err instanceof Error ? err.message : String(err)
        errors.push({ day: day.ymd, app: spec.app, message })
        options.log?.(`  ✗ ${spec.command} ${day.ymd}: ${message}`)
        continue
      }

      if (options.signal?.aborted) {
        stopped = true
        break
      }

      if (!outcome.ok) {
        const message = outcome.message || `${spec.command} failed`
        errors.push({ day: day.ymd, app: spec.app, message })
        options.log?.(`  ✗ ${spec.command} ${day.ymd}: ${message}`)
        continue
      }

      if (await options.hasRecap(day, spec.app)) {
        recapped.push({ day: day.ymd, app: spec.app })
        options.log?.(`  ✓ ${spec.command} ${day.ymd}`)
        if (key in emptyMap) {
          delete emptyMap[key]
          await mutateCache({ remove: [key] })
        }
      } else {
        empty.push({ day: day.ymd, app: spec.app })
        emptyMap[key] = options.today.ymd
        await mutateCache({ set: { [key]: options.today.ymd } })
        options.log?.(`  – ${spec.command} ${day.ymd}: nothing to recap`)
      }
    }

    if (stopped) break
  }

  if (!options.dryRun && (cacheNeedsPrune || staleKeys.length > 0)) {
    await mutateCache({ remove: staleKeys })
  }

  const outcome = stopped || errors.length > 0 ? 'failed' : recapped.length > 0 ? 'acted' : 'nothing'
  return {
    outcome,
    daysChecked,
    recapped,
    empty,
    planned,
    skippedExisting,
    skippedEmpty,
    errors,
    ...(stopped ? { stopped: true } : {}),
  }
}

/** Concise one-line summary for CLI output and automation run logs. */
export function formatBackfillSummary(result: BackfillResult): string {
  if (result.stopped) return 'Stopped before recap backfill finished.'

  if (result.planned.length > 0) {
    return `Dry run: ${result.planned.length} missing recap(s) across ${result.daysChecked.length} day(s).`
  }

  const parts: string[] = []
  if (result.recapped.length > 0) parts.push(`backfilled ${result.recapped.length} recap(s)`)
  if (result.empty.length > 0) parts.push(`${result.empty.length} empty`)
  if (result.errors.length > 0) {
    const detail = result.errors.map((err) => `${err.day} ${err.app} (${err.message})`).join('; ')
    parts.push(`${result.errors.length} failed: ${detail}`)
  }

  if (parts.length === 0) {
    return result.daysChecked.length === 0
      ? 'No finished days ready for recap backfill.'
      : `All recaps up to date across ${result.daysChecked.length} day(s).`
  }
  const line = parts.join(', ')
  return line.charAt(0).toUpperCase() + line.slice(1) + '.'
}
