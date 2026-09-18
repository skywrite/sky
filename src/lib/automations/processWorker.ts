import process from 'node:process'
import CommandContext from '#commands/lib/core/CommandContext.ts'
import CommandService from '#commands/lib/core/CommandService.ts'
import { workstreamStoragePaths } from '#lib/workstreams/storagePaths.ts'
import { routeAISDKWarningsToLog } from '#shared/ai/errorLog.ts'
import * as config from '#shared/config.ts'
import { configureLogging } from '#shared/log.ts'
import { env } from '#shared/sys/mod.ts'
import { configureTiming } from '#shared/timing/log.ts'
import { ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { commandOutcome } from './commandOutcome.ts'
import { invokeAutomation } from './invoke.ts'
import type { AutomationPassInput } from './process.ts'
import runDueAutomations from './runDue.ts'

export default async function runAutomationPass(input: AutomationPassInput) {
  process.env.TZ = input.timezone
  configureLogging({ stream: 'cli', console: false })
  configureTiming({ source: 'service' })
  routeAISDKWarningsToLog()
  const systemNow = new ZonedDateTime(input.dateTime, input.timezone)
  const context = CommandContext.server(config, env.toObject()).fork({ systemNow })
  const service = new CommandService(context)
  return runDueAutomations({
    dir: config.DIR_AUTOMATIONS,
    additionalDirs: [workstreamStoragePaths(config).automationsDir],
    statePath: config.FILE_AUTOMATIONS_STATE,
    systemNow,
    timeoutMs: null,
    invoke: async ({ run, args, context }) => commandOutcome(await invokeAutomation(service, run, args, context.now)),
  })
}
