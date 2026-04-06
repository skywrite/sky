import { readTextFile, writeTextFile } from '#shared/fs/mod.ts'
import ListDocument from '#shared/models/Markdown/ListDocument/mod.ts'
import type ItemList from '#shared/models/Markdown/ItemList/mod.ts'
import { categoryTodo, Command, CommandResult, dayNoFutureArg } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'

const params = {
  day: dayNoFutureArg(),
  category: categoryTodo(),
}

type Params = InferParams<typeof params>

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'day:todo:putback': { params: Params; result: undefined }
  }
}

export default class DayTodoPutbackTask extends Command {
  static override description: CommandDescription = {
    name: 'day:todo:putback',
    description: 'Put unfinished tasks back in the Next list',
    params,
  }

  async run({ args, context, tasks }: CommandArgs<Params>): Promise<CommandResult> {
    const { category, day } = args

    const result = await tasks.run('day:todo:incomplete', { day, category })
    if (!result.ok) return result

    const incompleteList = (result.data?.incompleteItems as Map<string, ItemList>)?.get(category)
    if (!incompleteList || incompleteList.size === 0) return CommandResult.success()

    // Add items to Next list
    const contents = await readTextFile(<string>context.config.FILE_NEXT_PROFESSIONAL)
    const nextActionsDoc = ListDocument.fromMarkdown(contents)

    const listNext = nextActionsDoc.lists.find((list) => list.title === 'Next')
    if (!listNext) return CommandResult.error('Cannot find list Next.')

    const newNextList = incompleteList.concat(listNext, { title: 'Next' })
    await writeTextFile(
      <string>context.config.FILE_NEXT_PROFESSIONAL,
      nextActionsDoc.replaceList('Next', newNextList).toMarkdown(),
    )

    context.output.log(`\n  Put back ${incompleteList.size} items.\n`)
    return CommandResult.success()
  }
}
