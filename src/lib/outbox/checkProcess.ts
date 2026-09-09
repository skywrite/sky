import * as path from 'node:path'
import type * as Config from '#config'
import { createProcessJob } from '#lib/jobs/mod.ts'
import { loadAutomationDir } from '#shared/models/Automation/loadAutomationDir.ts'
import { readScanProgress } from './progress.ts'
import type { OutboxStore } from './store.ts'
import { OutboxError } from './types.ts'

export type CheckProcessInput = { name: string; previousScanId: string | null }
export type CheckProcessResult = { outcome: 'acted' | 'nothing' | 'failed'; message?: string }

export function createCheckProcess(config: typeof Config, env: Record<string, string>, store: OutboxStore) {
  const job = createProcessJob<CheckProcessInput, CheckProcessResult>({
    dir: path.join(store.stateDir, 'check-job'),
    module: new URL('./checkWorker.ts', import.meta.url),
    env: {
      ...env,
      SKY_DIR: config.DIR_BASE,
      SKY_DATA_DIR: config.DIR_USER_DATA,
      SKY_CODE_DIR: config.DIR_CODE,
      SKY_INPUT_DIR: config.DIR_INPUT,
      SKY_OUTPUT_DIR: config.DIR_OUTPUT,
    },
  })
  return {
    async start() {
      const { byName } = await loadAutomationDir(config.DIR_AUTOMATIONS)
      const automation = [...byName.values()].find(({ automation }) => automation.run === 'outbox:scan')?.automation
      if (!automation) throw new OutboxError('Enable Outbox first.')
      const accepted = await job.start({
        name: automation.name,
        previousScanId: (await readScanProgress(store))?.id ?? null,
      })
      if (accepted.status === 'failed') throw new OutboxError(accepted.error ?? 'The check worker could not start.')
    },
    async status() {
      const current = await job.status()
      return current
        ? {
            running: current.status === 'running',
            previousScanId: current.input.previousScanId,
            result:
              current.status === 'failed'
                ? { outcome: 'failed' as const, message: current.error ?? 'The check worker stopped before finishing.' }
                : (current.result ?? null),
          }
        : null
    },
  }
}
