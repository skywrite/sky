import { Arg, Command, CommandResult } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { draftWorkstream, type WorkstreamDraft } from '#lib/workstreams/ai.ts'
import { createWorkstreamsRuntime } from '#lib/workstreams/runtime.ts'
import { workstreamNow } from '#lib/workstreams/store.ts'
import { fetchNowSync } from '#shared/nbfs/mod.ts'

const params = { objective: Arg.string('What you want to accomplish, in your own words') }
type Params = InferParams<typeof params>

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'workstreams:draft': { params: Params; result: WorkstreamDraft }
  }
}

export default class WorkstreamsDraft extends Command {
  static override description: CommandDescription = {
    name: 'workstreams:draft',
    description: 'Distill an objective into a tentative workstream proposal. Writes nothing.',
    usage: ['sky workstreams:draft "Prepare the Atlas pilot"'],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<WorkstreamDraft>> {
    const { store } = createWorkstreamsRuntime(context.config)
    const existing = (await store.list()).map(({ id, title, outcome, state }) => ({ id, title, outcome, state }))
    const result = await draftWorkstream({
      objective: args.objective,
      existing,
      now: workstreamNow(),
      today: fetchNowSync().plainDateTime.plainDate.ymd,
    })
    context.output.log(JSON.stringify(result, null, 2))
    return CommandResult.success(result, 'Prepared a proposal. No workstream or standing responsibility was created.')
  }
}
