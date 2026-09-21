import type { CommandArgs, CommandDescription } from '#commands/lib/commands.d.ts'
import { Command, CommandResult, dayArg } from '#commands/mod.ts'

const params = { day: dayArg() }

export default class DaySrUpdateTask extends Command {
  static override description: CommandDescription = {
    name: 'day:sr:update',
    params,
    description: 'Calls day:recurring:update, day:schedule:update, and day:reminders:update.',
  }

  async run({ tasks, args }: CommandArgs): Promise<CommandResult> {
    return tasks.runSequential([
      ['day:recurring:update'],
      ['day:schedule:update', { day: args.day }],
      ['day:reminders:update'],
    ])
  }
}
