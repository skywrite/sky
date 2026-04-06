import { Command, CommandResult } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription } from '#commands/lib/commands.d.ts'
import { fetchNowSync } from '#shared/nbfs/mod.ts'

export default class NowTask extends Command {
  static override description: CommandDescription = {
    name: 'util:now',
    description: 'Output current notebook time.',
  }

  async run({ context }: CommandArgs): Promise<CommandResult> {
    const { output } = context
    const now = fetchNowSync()
    output.log(now.plainDateTime.toString())

    return CommandResult.success()
  }
}
