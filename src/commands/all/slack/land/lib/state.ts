import { atomicWrite, readOptional } from '#lib/outbox/files.ts'
import { parse, stringify } from '#shared/yaml/mod.ts'

/** What one landing pass came to. */
export type LandRun = {
  /** Local date-time the pass started */
  at: string
  /** Threads landed or brought up to date */
  threads: number
  /** Direct and group conversations landed */
  conversations: number
  /** Day documents written or changed */
  docs: number
  /** Threads already in the notebook with nothing new */
  known: number
  errors: number
  seconds: number
}

/** The page shows the last few passes; the state keeps this many. */
export const LAND_RUNS_KEPT = 5

/** Where the landing left off: the newest activity it handled and the newest own message it saw, as ts. */
export type LandState = { feedCursor?: string; ownCursor?: string; runs: LandRun[] }

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0
}

export function parseLandState(contents: string | undefined): LandState {
  if (!contents?.trim()) return { runs: [] }
  const data = parse(contents) as { feedCursor?: unknown; ownCursor?: unknown; runs?: unknown } | null
  const runs: LandRun[] = []
  for (const entry of Array.isArray(data?.runs) ? data.runs : []) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const at = text(record.at)
    if (!at) continue
    runs.push({
      at,
      threads: count(record.threads),
      conversations: count(record.conversations),
      docs: count(record.docs),
      known: count(record.known),
      errors: count(record.errors),
      seconds: count(record.seconds),
    })
  }
  return {
    ...(text(data?.feedCursor) ? { feedCursor: text(data?.feedCursor) } : {}),
    ...(text(data?.ownCursor) ? { ownCursor: text(data?.ownCursor) } : {}),
    runs: runs.slice(0, LAND_RUNS_KEPT),
  }
}

export function serializeLandState(state: LandState): string {
  return stringify({
    ...(state.feedCursor ? { feedCursor: state.feedCursor } : {}),
    ...(state.ownCursor ? { ownCursor: state.ownCursor } : {}),
    ...(state.runs.length > 0 ? { runs: state.runs.slice(0, LAND_RUNS_KEPT) } : {}),
  })
}

export async function readLandState(file: string): Promise<LandState> {
  return parseLandState(await readOptional(file))
}

export async function writeLandState(file: string, state: LandState): Promise<void> {
  await atomicWrite(file, serializeLandState(state))
}
