import { Command, CommandResult } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription } from '#commands/mod.ts'
import { createWorkstreamsRuntime } from '#lib/workstreams/runtime.ts'
import type { WorkstreamRecord } from '#lib/workstreams/types.ts'

type Result = { items: WorkstreamRecord[]; errors: { path: string; message: string }[] }
declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'workstreams:list': { params: Record<string, never>; result: Result }
  }
}

export default class WorkstreamsList extends Command {
  static override description: CommandDescription = {
    name: 'workstreams:list',
    description: 'Read workstreams, current activities, decisions, and recorded Sky progress.',
    usage: ['sky workstreams:list'],
  }

  async run({ context }: CommandArgs): Promise<CommandResult<Result>> {
    const { store } = createWorkstreamsRuntime(context.config)
    const result = await store.report()
    context.output.log(JSON.stringify(result, null, 2))
    return CommandResult.success(result)
  }
}
