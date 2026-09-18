import { Command, CommandResult } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription } from '#commands/mod.ts'
import { createWorkstreamsRuntime } from '#lib/workstreams/runtime.ts'
import { setupWorkstreams } from '#lib/workstreams/setup.ts'

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'workstreams:setup': { params: Record<string, never>; result: { created: boolean; name: string } }
  }
}

export default class WorkstreamsSetup extends Command {
  static override description: CommandDescription = {
    name: 'workstreams:setup',
    description: 'Enable scheduled reviews for workstreams explicitly entrusted to Sky.',
    usage: ['sky workstreams:setup'],
  }

  async run({ context }: CommandArgs): Promise<CommandResult<{ created: boolean; name: string }>> {
    const { store } = createWorkstreamsRuntime(context.config)
    await store.initialize()
    const result = await setupWorkstreams(context.config.DIR_AUTOMATIONS, store.stateDir, context.systemNow.date)
    const message = result.created
      ? 'Workstream reviews enabled. Each workstream still needs its own Sky responsibility.'
      : 'Workstreams already has an automation. Its schedule and status were preserved.'
    context.output.log(message)
    return CommandResult.success(result, message)
  }
}
