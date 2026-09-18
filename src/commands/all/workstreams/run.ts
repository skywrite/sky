import { Arg, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { runWorkstream } from '#lib/workstreams/runner.ts'
import { createWorkstreamsRuntime } from '#lib/workstreams/runtime.ts'
import type { WorkstreamRun } from '#lib/workstreams/types.ts'

const params = {
  id: Arg.string('The workstream identity'),
  request: Flag.string('A specific piece of work or question to address', { optional: true }),
}
type Params = InferParams<typeof params>

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'workstreams:run': { params: Params; result: WorkstreamRun }
  }
}

export default class WorkstreamsRun extends Command {
  static override description: CommandDescription = {
    name: 'workstreams:run',
    description: 'Have Sky review one entrusted workstream and prepare useful local work within its responsibility.',
    usage: ['sky workstreams:run <id>'],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<WorkstreamRun>> {
    const runtime = createWorkstreamsRuntime(context.config)
    const result = await runWorkstream({
      ...runtime,
      id: args.id,
      request: args.request,
      trigger: 'manual',
      now: context.systemNow.toUTC().normalize().plainDateTime.toString(),
    })
    context.output.log(result.summary)
    return result.status === 'failed' || result.status === 'interrupted'
      ? CommandResult.fail(result.error ?? result.summary, result)
      : CommandResult.success(result, result.summary)
  }
}
