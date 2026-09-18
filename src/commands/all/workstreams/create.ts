import { Arg, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { workstreamIdentityTime } from '#lib/workstreams/identities.ts'
import { createWorkstreamsRuntime } from '#lib/workstreams/runtime.ts'
import type { WorkstreamRecord } from '#lib/workstreams/types.ts'

const params = {
  title: Arg.string('The name of this body of work'),
  outcome: Flag.string('The desired outcome, when understood', { optional: true }),
}
type Params = InferParams<typeof params>

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'workstreams:create': { params: Params; result: WorkstreamRecord }
  }
}

export default class WorkstreamsCreate extends Command {
  static override description: CommandDescription = {
    name: 'workstreams:create',
    description: 'Create a human-driven workstream without required dates, people, or metrics.',
    usage: ['sky workstreams:create "Atlas pilot" --outcome "Complete a useful pilot"'],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<WorkstreamRecord>> {
    const { store } = createWorkstreamsRuntime(context.config)
    const result = await store.create(
      { title: args.title, outcome: args.outcome ?? '' },
      context.systemNow.toUTC().normalize().plainDateTime.toString(),
      { identityTime: workstreamIdentityTime(context.systemNow.timezone) },
    )
    context.output.log(JSON.stringify(result, null, 2))
    return CommandResult.success(result)
  }
}
