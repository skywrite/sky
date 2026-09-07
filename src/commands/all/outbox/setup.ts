import { Command, CommandResult } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription } from '#commands/mod.ts'
import { createOutboxRuntime } from '#lib/outbox/runtime.ts'
import { setupOutbox } from '#lib/outbox/setup.ts'

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'outbox:setup': { params: Record<string, never>; result: { created: boolean; name: string } }
  }
}

export default class OutboxSetup extends Command {
  static override description: CommandDescription = {
    name: 'outbox:setup',
    description: 'Enable Outbox as a system automation for saved Slack and email conversations.',
    usage: ['sky outbox:setup'],
  }

  async run({ context }: CommandArgs): Promise<CommandResult<{ created: boolean; name: string }>> {
    const { store } = createOutboxRuntime(context.config)
    const result = await setupOutbox(context.config.DIR_AUTOMATIONS, store.stateDir, context.systemNow.date)
    const message = result.created
      ? 'Outbox enabled. Review drafts at /outbox; it checks saved conversations every 5 minutes.'
      : 'Outbox already has an automation. Its schedule and status were preserved.'
    context.output.log(message)
    return CommandResult.success(result, message)
  }
}
