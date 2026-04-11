import { Command, CommandResult, dayNoFutureArg } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'

const params = {
  day: dayNoFutureArg(),
}

type Params = InferParams<typeof params>

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'day:reminders:move-next': { params: Params; result: undefined }
  }
}

export default class DayRemindersMoveNextTask extends Command {
  static override description: CommandDescription = {
    name: 'day:reminders:move-next',
    description: "Move unfinished reminders to the next day's Reminders list",
    params,
  }

  async run({ args, tasks }: CommandArgs<Params>): Promise<CommandResult> {
    const { day } = args

    return tasks.run('day:reminders:move-future', {
      old: day,
      new: day.addDays(1),
    })
  }
}
