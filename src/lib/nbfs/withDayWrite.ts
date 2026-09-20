import * as path from 'node:path'
import { withLock } from '#lib/outbox/files.ts'
import { workstreamStoragePaths, type WorkstreamStorageConfig } from '#lib/workstreams/storagePaths.ts'

/**
 * One writer at a time per day file. A day write reads the whole file,
 * changes it in memory and writes the whole file back, so two writers that
 * overlap both start from the same bytes and the later write erases the
 * earlier one. This is the lock the web day page takes around its item
 * writes: a command and the page never overlap either. It lives beside the
 * page's, outside the synced notebook.
 */
export default function withDayWrite<T>(
  config: WorkstreamStorageConfig,
  ymd: string,
  run: () => Promise<T>,
): Promise<T> {
  return withLock(path.join(workstreamStoragePaths(config).stateDir, `day-${ymd}.lock`), run)
}
