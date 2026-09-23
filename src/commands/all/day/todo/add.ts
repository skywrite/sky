import { taskLinkLabel } from '#commands/lib/linkLabel.ts'
import { ArgOrFlag, category, Command, CommandResult, dayFlag, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { fileTaskItems } from '#lib/nbfs/fileTaskItems.ts'
import { commandPlanningDate } from '#lib/nbfs/taskDestination.ts'
import type { Link } from '#shared/models/Markdown/Link/mod.ts'

const params = {
  task: ArgOrFlag.string('Task to add', { short: 't', required: true }),
  category: category(),
  link: Flag.string('Link for task', { short: 'l' }),
  when: dayFlag({ short: 'w' }),
}

type Params = InferParams<typeof params>

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'day:todo:add': { params: Params; result: undefined }
  }
}

export default class DayTodoAddTask extends Command {
  static override description: CommandDescription = {
    name: 'day:todo:add',
    description: 'Add a task to the todos.',
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult> {
    const { config, output } = context
    const { task, category, link, when } = args

    let linkMap: Map<string, Link> | undefined = undefined
    let taskWithLink = task
    if (link) {
      const commandDesc = await taskLinkLabel(task)

      output.log(commandDesc)

      const linkObj = {
        href: link,
        label: commandDesc,
      }

      linkMap = new Map()
      linkMap.set(commandDesc, linkObj)

      taskWithLink = `${task} [${commandDesc}][]`
    }

    const list = `${category} Todos`
    const filed = await fileTaskItems(config, commandPlanningDate(context), when, list, [taskWithLink], linkMap)
    if (filed === 'schedule') output.log(`Added to schedule for ${when.ymd}`)
    return CommandResult.success()
  }
}
