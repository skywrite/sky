import * as path from 'node:path'
import { parsePartialDate } from '#commands/lib/args/parsePartialDate.ts'
import type { CommandArgs, CommandDescription } from '#commands/lib/commands.d.ts'
import { categoryTodo, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { InferParams } from '#commands/mod.ts'
import { DIR_TIME } from '#config'
import { exists } from '#shared/fs/mod.ts'
import type ItemList from '#shared/models/Markdown/ItemList/mod.ts'
import { dayFile, readDay, writeDay } from '#shared/nbfs/mod.ts'

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

  async run({ args, context, tasks }: CommandArgs<Params>): Promise<CommandResult> {
    const { category, old: oldDate, new: newDate, noIncomplete } = args

    const result = await tasks.run('day:todo:incomplete', { day: oldDate, category, cleanOnly: noIncomplete })
    if (!result.ok) return result

    const incompleteList = result.data?.incompleteItems?.get(category)
    if (!incompleteList || incompleteList.size === 0) return CommandResult.success()

    const targetFile = path.join(DIR_TIME, dayFile(newDate))
    if (!(await exists(targetFile))) {
      return CommandResult.error(`Day file does not exist: ${newDate.ymd}. Create it first with 'sky day:new'.`)
    }

    const nextDayDoc = await readDay(newDate)
    const listNextDayTodos = nextDayDoc.lists.find((list) => list.title === category)
    if (!listNextDayTodos) return CommandResult.error(`Cannot find ${newDate.ymd} ${category}.`)

    const newNextDayDoc = nextDayDoc.replaceList(category, listNextDayTodos.concat(incompleteList))
    await writeDay(newNextDayDoc)

    context.output.log(`\n  Moved ${incompleteList.size} items.\n`)
    return CommandResult.success()
  }
}
