import CommandContext from '#commands/lib/core/CommandContext.ts'
import CommandService from '#commands/lib/core/CommandService.ts'
import * as config from '#config'
import { env } from '#shared/sys/mod.ts'
import type { CheckProcessInput, CheckProcessResult } from './checkProcess.ts'

/** The worker owns the automation stamp as well as the scan, even if its web host exits. */
export default async function checkWorker(input: CheckProcessInput): Promise<CheckProcessResult> {
  const commands = new CommandService(CommandContext.server(config, env.toObject()))
  const result = await commands.run('automations:run', { name: input.name, stamp: true })
  return {
    outcome: result.status === 'success' ? (result.data?.outcome ?? 'nothing') : 'failed',
    message: result.data?.message ?? result.message,
  }
}
