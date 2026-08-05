import type { CommandArgs, CommandDescription } from '#commands/lib/commands.d.ts'
import { categoryTodo, Command, CommandResult, dayNoFutureArg, Flag } from '#commands/mod.ts'
import type { InferParams } from '#commands/mod.ts'
import DayDocument from '#shared/models/Day/mod.ts'
import ItemList from '#shared/models/Markdown/ItemList/mod.ts'
import { readDay, writeDay } from '#shared/nbfs/mod.ts'

const params = {
  day: dayNoFutureArg(),
  category: categoryTodo(),
  dryRun: Flag.boolean('Return incomplete items without modifying the day', {
    short: 'd',
    default: false,
  }),
  cleanOnly: Flag.boolean('Clean todos but do not create Incomplete section', {
    short: 'C',
    default: false,
  }),
}

type Params = InferParams<typeof params>
type Result = { incompleteItems: Map<string, ItemList> }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'day:todo:incomplete': { params: Params; result: Result }
  }
}

export default class DayTodoIncompleteTask extends Command {
  static override description: CommandDescription = {
    name: 'day:todo:incomplete',
    description: 'Move unfinished todo items to Incomplete section',
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context
    const { category, day, dryRun, cleanOnly } = args

    const dayDoc = await readDay(day)

    const listDayTodos = dayDoc.lists.find((list) => list.title === category)
    if (!listDayTodos) return CommandResult.error(`Cannot find ${day.ymd} ${category}.`)

    const listDayNotDone = listDayTodos.filter(DayDocument.isItemNotDone)
    const listDayDone = listDayTodos.filter(DayDocument.isItemDone)

    const incompleteItems = new Map<string, ItemList>()
    incompleteItems.set(category, listDayNotDone)

    if (listDayNotDone.size === 0) {
      output.log(`\n  No incomplete items in ${category}.\n`)
      return CommandResult.success({ incompleteItems })
    }

    if (dryRun) {
      output.log(`\n  ${listDayNotDone.size} incomplete items in ${category}:\n`)
      for (const item of listDayNotDone) {
        output.log(`    - ${item}`)
      }
      output.log('')
      return CommandResult.success({ incompleteItems })
    }

    let newDayDoc = dayDoc.replaceList(category, listDayDone)
    if (!cleanOnly) {
      const incompleteTitle = category.replace('Todos', 'Incomplete')
      newDayDoc = newDayDoc.addList(listDayNotDone.update({ title: incompleteTitle }))
    }

    await writeDay(newDayDoc)

    if (cleanOnly) {
      output.log(`\n  Cleaned ${listDayNotDone.size} incomplete items from ${category}.\n`)
    } else {
      const incompleteTitle = category.replace('Todos', 'Incomplete')
      output.log(`\n  Moved ${listDayNotDone.size} items to ${incompleteTitle}.\n`)
    }
    return CommandResult.success({ incompleteItems })
  }
}
