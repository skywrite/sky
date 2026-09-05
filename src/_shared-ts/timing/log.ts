import { appendFileSync, mkdirSync } from 'node:fs'
import * as path from 'node:path'
import { DIR_USER_DATA } from '#config'
import { instantNow, PlainDate } from '#universal/dates/nbdt/mod.ts'
import { setTimingSink, type TimingEvent } from './mod.ts'
import { installTimingTelemetry } from './sdk.ts'

export const TIMING_LOG_DIR = path.join(DIR_USER_DATA, 'logs', 'timing')

/** Hosts enable this once; every call is recorded without consumer opt-in. */
export function configureTiming({ source, dir = TIMING_LOG_DIR }: { source: 'cli' | 'service'; dir?: string }): void {
  installTimingTelemetry()
  let ready = false
  setTimingSink((event: TimingEvent) => {
    try {
      if (!ready) {
        mkdirSync(dir, { recursive: true, mode: 0o700 })
        ready = true
      }
      appendFileSync(
        path.join(dir, `${PlainDate.today().ymd}.jsonl`),
        JSON.stringify({ version: 1, source, ts: instantNow(), ...event }) + '\n',
        { mode: 0o600 },
      )
    } catch {
      /* Timing is observational even when the disk is unavailable. */
    }
  })
}
