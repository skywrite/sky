import type { CommandArgs, CommandDescription } from '#commands/lib/commands.d.ts'
import { categoryTodo, Command, CommandResult, dayNoFutureArg, Flag } from '#commands/mod.ts'
import type { InferParams } from '#commands/mod.ts'

const params = {
  day: dayNoFutureArg(),
  category: categoryTodo(),
  noIncomplete: Flag.bool('Do not create an Incomplete section in the source day', {
    short: 'I',
    default: false,
  }),
}

type Params = InferParams<typeof params>

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'day:todo:move-next': { params: Params; result: undefined }
  }
}

export default class DayTodoMoveNextTask extends Command {
  static override description: CommandDescription = {
    name: 'day:todo:move-next',
    description: 'Put unfinished tasks to the next days todos',
    params,
  }

  async run({ args, tasks }: CommandArgs<Params>): Promise<CommandResult> {
    const { category, day, noIncomplete } = args

    return tasks.run('day:todo:move-future', {
      old: day,
      new: day.addDays(1),
      category,
      noIncomplete,
    })
  }
}
