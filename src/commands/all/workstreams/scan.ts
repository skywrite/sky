import { Command, CommandResult } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription } from '#commands/mod.ts'
import { scanWorkstreams, type WorkstreamScanReport } from '#lib/workstreams/runner.ts'
import { createWorkstreamsRuntime } from '#lib/workstreams/runtime.ts'

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'workstreams:scan': { params: Record<string, never>; result: WorkstreamScanReport }
  }
}

export default class WorkstreamsScan extends Command {
  static override description: CommandDescription = {
    name: 'workstreams:scan',
    description: 'Review entrusted workstreams when context changes or agreed reviews and reports are due.',
    usage: ['sky workstreams:scan'],
  }

  async run({ context }: CommandArgs): Promise<CommandResult<WorkstreamScanReport>> {
    const runtime = createWorkstreamsRuntime(context.config)
    const result = await scanWorkstreams({
      ...runtime,
      now: context.systemNow.toUTC().normalize().plainDateTime.toString(),
    })
    const message = result.failed
      ? `Reviewed ${result.reviewed} workstreams; ${result.failed} need attention.`
      : result.reviewed
        ? `Reviewed ${result.reviewed} workstreams and recorded the results.`
        : 'No workstream review is due.'
    context.output.log(message)
    return result.failed ? CommandResult.fail(message, result) : CommandResult.success(result, message)
  }
}
