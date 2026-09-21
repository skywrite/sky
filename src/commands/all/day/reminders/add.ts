import { taskLinkLabel } from '#commands/lib/linkLabel.ts'
import { ArgOrFlag, Command, CommandResult, dayFlag, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { fileTaskItems } from '#lib/nbfs/fileTaskItems.ts'
import { commandPlanningDate } from '#lib/nbfs/taskDestination.ts'
import type { Link } from '#shared/models/Markdown/Link/mod.ts'

const params = {
  task: ArgOrFlag.string('Task to add', { short: 't', required: true }),
  link: Flag.string('Link for task', { short: 'l' }),
  when: dayFlag({ short: 'w' }),
}

type Params = InferParams<typeof params>

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'day:reminders:add': { params: Params; result: undefined }
  }
}

export default class DayRemindersAddTask extends Command {
  static override description: CommandDescription = {
    name: 'day:reminders:add',
    description: 'Add a task to the reminders section.',
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult> {
    const { config, output } = context
    const { task, link, when } = args

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

    await fileTaskItems(config, commandPlanningDate(context), when, 'Reminders', [taskWithLink], linkMap)
    return CommandResult.success()
  }
}
