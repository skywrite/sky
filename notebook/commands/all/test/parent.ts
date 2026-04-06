import { Command, CommandArgs, CommandDescription, CommandResult } from '#commands/mod.ts'

type Result = {
  parentTaskName: string | undefined
  compositionDepth: number
}

/**
 * Test task that returns its parentTaskName and compositionDepth.
 * Used for testing CommandService composition behavior.
 */
export default class TestParentTask extends Command {
  static override description: CommandDescription = {
    name: 'test:parent',
    description: 'Return parentTaskName and compositionDepth for testing',
  }

  async run({ context }: CommandArgs): Promise<CommandResult<Result>> {
    return CommandResult.success({
      parentTaskName: context.parentTaskName,
      compositionDepth: context.compositionDepth,
    })
  }
}
