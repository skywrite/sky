import { parsePartialDate } from '#commands/lib/args/parsePartialDate.ts'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { carryItems } from '../_carryItems.ts'

const params = {
  old: Flag.plainDate('Old Day (e.g., 27, 8-27, 2025-08-27)', {
    short: 'o',
    required: true,
    parse: (input: string) => parsePartialDate(input, { rejectFuture: true }),
  }),
  new: Flag.plainDate('New Day (e.g., 27, 8-27, 2025-08-27)', {
    short: 'n',
    required: true,
    parse: (input: string) => parsePartialDate(input, { rejectFuture: false }),
  }),
}

type Params = InferParams<typeof params>

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'day:reminders:move-future': { params: Params; result: undefined }
  }
}

export default class DayReminderMoveFutureTask extends Command {
  static override description: CommandDescription = {
    name: 'day:reminders:move-future',
    description: "Move unfinished reminders to another day's Reminders list",
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult> {
    const count = await carryItems(context, args.old, args.new, 'Reminders', {})
    context.output.log(`\n  Moved ${count} reminders to ${args.new.ymd}.\n`)
    return CommandResult.success()
  }
}
