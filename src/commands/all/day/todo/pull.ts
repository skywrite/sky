import { Arg, categoryTodo, Command, CommandResult } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { readTextFile, writeTextFile } from '#shared/fs/mod.ts'
import ListDocument from '#shared/models/Markdown/ListDocument/mod.ts'
import { readDay, writeDay } from '#shared/nbfs/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'

const params = {
  when: Arg.string('When in YYYY-MM-DD', { default: () => new PlainDate().ymd }),
  category: categoryTodo(),
}

type Params = InferParams<typeof params>

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'day:todo:pull': { params: Params; result: undefined }
  }
}

export default class DayTodoPullTask extends Command {
  static override description: CommandDescription = {
    name: 'day:todo:pull',
    description: 'Pull next task from Next list into day todos',
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult> {
    const { config, output } = context
    const { category, when } = args

    // when is already a YMD string, pass directly to readDay
    const dayDoc = await readDay(when)

    const contents = await readTextFile(<string>config.FILE_NEXT_PROFESSIONAL)
    const nextActionsDoc = ListDocument.fromMarkdown(contents)

    const listDayTodos = dayDoc.lists.find((list) => list.title === category)
    if (!listDayTodos) return CommandResult.error(`Cannot find ${when} Day todos.`)

    const listNext = nextActionsDoc.lists.find((list) => list.title === 'Next')
    if (!listNext) return CommandResult.error('Cannot find list Next.')

    const { newList: newNextList, links: newLinks, value } = listNext.remove(0)

    if (!value) return CommandResult.error(`No value in the Next list.`)

    const newNextActionsDoc = nextActionsDoc.replaceList('Next', newNextList)
    await writeTextFile(<string>config.FILE_NEXT_PROFESSIONAL, newNextActionsDoc.toMarkdown())

    const newDayDoc = dayDoc.addItem(category, value, { links: newLinks })
    await writeDay(newDayDoc)

    output.log(`\n  Added "${value}" to the todos of ${when}.\n`)
    return CommandResult.success()
  }
}
