import type { CommandArgs, CommandDescription } from '#commands/lib/commands.d.ts'
import { Command, CommandResult } from '#commands/mod.ts'

export default class DaySrUpdateTask extends Command {
  static override description: CommandDescription = {
    name: 'day:sr:update',
    description: 'Calls day:recurring:update, day:schedule:update, and day:reminders:update.',
  }

  async run({ tasks }: CommandArgs): Promise<CommandResult> {
    return tasks.runSequential([['day:recurring:update'], ['day:schedule:update'], ['day:reminders:update']])
  }
}
