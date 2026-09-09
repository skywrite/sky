import { describeOutboxScan } from '#lib/outbox/describeScan.ts'
import type { ScanProgress } from '#lib/outbox/types.ts'
import type { OutboxCheck, OutboxScanResult } from './mod.ts'

export type ScanExecution = {
  start: () => Promise<void>
  status: () => Promise<{
    running: boolean
    previousScanId: string | null
    result: OutboxScanResult | null
  } | null>
}

/** Execution and progress belong to the worker; a new host simply reads them again. */
export function createScanJob(execution: ScanExecution, progress: () => Promise<ScanProgress | null>) {
  return {
    async start(): Promise<OutboxScanResult> {
      if (!(await this.status()).running) await execution.start()
      return {
        outcome: 'nothing',
        running: true,
        message: 'Checking the selected range of saved Slack and email conversations.',
      }
    },
    async status(): Promise<OutboxCheck> {
      const worker = await execution.status()
      const current = await progress()
      const running = worker?.running === true || current?.status === 'running'
      // The accepted worker may still be loading commands. Do not display an old
      // check's completed counts or interruption warning during that handoff.
      const previous = current?.id === worker?.previousScanId
      return {
        running,
        progress: running && previous ? null : current,
        result: running
          ? null
          : worker?.result && (!current || previous)
            ? worker.result
            : current
              ? { outcome: current.outcome, message: current.error ?? describeOutboxScan(current) }
              : (worker?.result ?? null),
      }
    },
  }
}
