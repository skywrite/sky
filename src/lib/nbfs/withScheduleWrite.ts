import * as path from 'node:path'
import { withLock } from '#lib/outbox/files.ts'
import { workstreamStoragePaths, type WorkstreamStorageConfig } from '#lib/workstreams/storagePaths.ts'

/**
 * One writer at a time on the schedule files. They hold tasks beyond the current
 * week, every date in the same two files, so a per-day lock
 * does not cover them. See `withDayWrite` for why a write needs a lock.
 */
export default function withScheduleWrite<T>(config: WorkstreamStorageConfig, run: () => Promise<T>): Promise<T> {
  return withLock(path.join(workstreamStoragePaths(config).stateDir, 'schedule.lock'), run)
}
