import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { Command, CommandResult, dayArg } from '#commands/mod.ts'

const params = { day: dayArg() }
type Params = InferParams<typeof params>

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    // A stopped sequence forwards its child's failure data.
    'day:sr:update': { params: Params; result: unknown }
  }
}

export default class DaySrUpdateTask extends Command {
  static override description: CommandDescription = {
    name: 'day:sr:update',
    params,
    description: 'Calls day:recurring:update, day:schedule:update, and day:reminders:update.',
  }

  async run({ tasks, args }: CommandArgs<Params>): Promise<CommandResult> {
    return tasks.runSequential([
      ['day:recurring:update', { day: args.day }],
      ['day:schedule:update', { day: args.day }],
      ['day:reminders:update', { day: args.day }],
    ])
  }
}
