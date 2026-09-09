import * as path from 'node:path'
import process from 'node:process'
import { readOptional } from './files.ts'
import type { OutboxStore } from './store.ts'
import type { ScanProgress } from './types.ts'

export async function readScanProgress(store: OutboxStore): Promise<ScanProgress | null> {
  const text = await readOptional(path.join(store.stateDir, 'scan-progress.json'))
  if (!text) return null
  const progress = JSON.parse(text) as ScanProgress
  if (progress.status === 'running') {
    try {
      process.kill(progress.owner, 0)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
      return {
        ...progress,
        status: 'failed',
        outcome: 'failed',
        error: 'The check worker stopped before finishing. Check again to finish reviewing the selected range.',
      }
    }
  }
  return progress
}
