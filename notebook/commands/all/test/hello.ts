import { Command, CommandResult } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription } from '#commands/mod.ts'

export default class TestHelloTask extends Command {
  static override description: CommandDescription = {
    name: 'test:hello',
    description: 'Hello world - verifies the task runner boots',
  }

  async run({ context }: CommandArgs): Promise<CommandResult> {
    context.output.log('Hello from the task runner!')
    return CommandResult.success()
  }
}
