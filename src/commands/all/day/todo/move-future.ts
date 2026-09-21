import { parsePartialDate } from '#commands/lib/args/parsePartialDate.ts'
import type { CommandArgs, CommandDescription } from '#commands/lib/commands.d.ts'
import { categoryTodo, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { InferParams } from '#commands/mod.ts'
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
  category: categoryTodo(),
  noIncomplete: Flag.bool('Do not create an Incomplete section in the source day', {
    short: 'I',
    default: false,
  }),
}

type Params = InferParams<typeof params>

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'day:todo:move-future': { params: Params; result: undefined }
  }
}

export default class DayTodoMoveFutureTask extends Command {
  static override description: CommandDescription = {
    name: 'day:todo:move-future',
    description: "Put unfinished tasks to another day's todos",
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult> {
    const count = await carryItems(context, args.old, args.new, args.category, { incomplete: !args.noIncomplete })
    context.output.log(`\n  Moved ${count} todos to ${args.new.ymd}.\n`)
    return CommandResult.success()
  }
}
