import { atomicWrite, readOptional } from '#lib/outbox/files.ts'
import { parse, stringify } from '#shared/yaml/mod.ts'

/** A joined channel the pull keeps up to date, with Sky's own cursor into it. */
export type PulledChannel = {
  id: string
  name: string
  /** ts of the newest message the pull has seen in this channel, thread replies included */
  cursor?: string
  /** Local date-time of the last read */
  pulledAt?: string
  /** Local date-time of the last read that went the whole backfill window back, to catch late thread replies */
  deepPulledAt?: string
}

/** What one full pull came to, for the Slack page's recent checks. */
export type PullRun = {
  /** Local date-time the pull started */
  at: string
  /** Messages new to the cache, thread replies included */
  added: number
  /** Channels that gained messages */
  channels: number
  /** Threads read for new replies */
  threads: number
  /** Channels read */
  read: number
  unchanged: number
  /** Muted channels left out */
  muted: number
  /** Channels whose read failed */
  errors: number
  seconds: number
}

/** The page shows the last few checks; the roster keeps this many. */
export const RUNS_KEPT = 5

export type Roster = { channels: PulledChannel[]; runs: PullRun[] }

function text(value: unknown): string | undefined {
  // A ts round-trips as a string; a number here would be a cursor that lost its digits
  return typeof value === 'string' && value ? value : undefined
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0
}

function parseRuns(value: unknown): PullRun[] {
  if (!Array.isArray(value)) return []
  const runs: PullRun[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const at = text(record.at)
    if (!at) continue
    runs.push({
      at,
      added: count(record.added),
      channels: count(record.channels),
      threads: count(record.threads),
      read: count(record.read),
      unchanged: count(record.unchanged),
      muted: count(record.muted),
      errors: count(record.errors),
      seconds: count(record.seconds),
    })
  }
  return runs.slice(0, RUNS_KEPT)
}

export function parseRoster(contents: string | undefined): Roster {
  if (!contents?.trim()) return { channels: [], runs: [] }
  const data = parse(contents) as { channels?: unknown; runs?: unknown } | null
  const entries = Array.isArray(data?.channels) ? data.channels : []
  const channels: PulledChannel[] = []
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const id = text(record.id)
    if (!id) continue
    channels.push({
      id,
      name: text(record.name) ?? id,
      cursor: text(record.cursor),
      pulledAt: text(record.pulledAt),
      deepPulledAt: text(record.deepPulledAt),
    })
  }
  return { channels, runs: parseRuns(data?.runs) }
}

export function serializeRoster(roster: Roster): string {
  return stringify({
    channels: roster.channels.map((channel) => ({
      id: channel.id,
      name: channel.name,
      ...(channel.cursor ? { cursor: channel.cursor } : {}),
      ...(channel.pulledAt ? { pulledAt: channel.pulledAt } : {}),
      ...(channel.deepPulledAt ? { deepPulledAt: channel.deepPulledAt } : {}),
    })),
    ...(roster.runs.length > 0 ? { runs: roster.runs.slice(0, RUNS_KEPT) } : {}),
  })
}

export async function readRoster(file: string): Promise<Roster> {
  return parseRoster(await readOptional(file))
}

export async function writeRoster(file: string, roster: Roster): Promise<void> {
  await atomicWrite(file, serializeRoster(roster))
}
