import { Command, CommandResult } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription } from '#commands/lib/commands.d.ts'

export default class NowTask extends Command {
  static override description: CommandDescription = {
    name: 'util:now',
    description: 'Output current notebook time.',
  }

  async run({ context }: CommandArgs): Promise<CommandResult> {
    const { output } = context
    try {
      const now = context.notebookNow
      output.log(now.plainDateTime.toString())
    } catch {
      return CommandResult.fail('Unable to compute notebook time. Start a day first with `sky day:start`.')
    }

    return CommandResult.success()
  }
}
