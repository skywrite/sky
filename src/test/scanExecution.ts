import type { ScanProgress } from '#lib/outbox/types.ts'
import type { OutboxScanResult } from '#service/handler/outbox/mod.ts'
import type { ScanExecution } from '#service/handler/outbox/scanJob.ts'

/** Synthetic execution shared by browser fixture hosts across reconnects. */
export function createTestScanExecution(
  run: () => Promise<OutboxScanResult>,
  progress: () => Promise<ScanProgress | null>,
): ScanExecution {
  let current: Awaited<ReturnType<ScanExecution['status']>> = null
  return {
    async start() {
      if (current?.running) return
      const accepted = { running: true, previousScanId: null as string | null, result: null as OutboxScanResult | null }
      current = accepted
      accepted.previousScanId = (await progress())?.id ?? null
      void Promise.resolve()
        .then(run)
        .then(
          (result) => {
            accepted.result = result
            accepted.running = false
          },
          (error: Error) => {
            accepted.result = { outcome: 'failed', message: error.message }
            accepted.running = false
          },
        )
    },
    async status() {
      return current
    },
  }
}
