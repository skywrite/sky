import { createHash } from 'node:crypto'
import * as path from 'node:path'
import type * as Config from '#config'
import { createProcessJob } from '#lib/jobs/mod.ts'
import type { ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import type { PassSummary } from './runDue.ts'

export type AutomationPassInput = { dateTime: string; timezone: string }

export function automationPassInput(now: ZonedDateTime): AutomationPassInput {
  return { dateTime: now.plainDateTime.toString(), timezone: now.timezone }
}

/** The whole scheduled pass, including its ledger, belongs to one surviving worker. */
export function createAutomationProcess(config: typeof Config, environment: Record<string, string>) {
  const notebook = createHash('sha256').update(config.DIR_BASE).digest('hex').slice(0, 16)
  return createProcessJob<AutomationPassInput, PassSummary>({
    dir: path.join(config.DIR_STATE, 'jobs', 'automations', notebook),
    module: new URL('./processWorker.ts', import.meta.url),
    cwd: config.DIR_CODE_SRC,
    env: {
      ...environment,
      SKY_DIR: config.DIR_BASE,
      SKY_DATA_DIR: config.DIR_USER_DATA,
      SKY_CODE_DIR: config.DIR_CODE,
      SKY_INPUT_DIR: config.DIR_INPUT,
      SKY_OUTPUT_DIR: config.DIR_OUTPUT,
    },
  })
}
