import { Command, CommandResult, dayNoFutureArg } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'

const params = {
  day: dayNoFutureArg(),
}

type Params = InferParams<typeof params>

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'day:reminders:copy-next': { params: Params; result: undefined }
  }
}

export default class DayRemindersCopyNextTask extends Command {
  static override description: CommandDescription = {
    name: 'day:reminders:copy-next',
    description: "Copy unfinished reminders to the next day's Reminders list (without removing from source)",
    params,
  }

  async run({ args, tasks }: CommandArgs<Params>): Promise<CommandResult> {
    const { day } = args

    return tasks.run('day:reminders:copy-future', {
      old: day,
      new: day.addDays(1),
    })
  }
}
