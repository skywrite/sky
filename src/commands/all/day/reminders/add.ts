import * as path from 'node:path'
import { taskLinkLabel } from '#commands/lib/linkLabel.ts'
import { ArgOrFlag, Command, CommandResult, dayFlag, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { dayFile } from '#lib/nbfs/mod.ts'
import { readTextFile, writeTextFile } from '#shared/fs/mod.ts'
import DayDocument from '#shared/models/Day/mod.ts'
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

    const file = path.join(<string>config.DIR_TIME, dayFile(when))
    const contents = await readTextFile(file)
    let dayObj = DayDocument.fromMarkdown(contents)

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

    dayObj = dayObj.addReminderItem(taskWithLink, { links: linkMap })

    await writeTextFile(file, dayObj.toMarkdown())
    return CommandResult.success()
  }
}
