import { taskLinkLabel } from '#commands/lib/linkLabel.ts'
import { ArgOrFlag, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { readTextFile, writeTextFile } from '#shared/fs/mod.ts'
import type { Link } from '#shared/models/Markdown/Link/mod.ts'
import ListDocument from '#shared/models/Markdown/ListDocument/mod.ts'

const params = {
  task: ArgOrFlag.string('Task to add', { short: 't', required: true }),
  category: Flag.string('Category: default is "Next"', { short: 'c', default: 'Next' }),
  link: Flag.string('Link for task', { short: 'l' }),
}

type Params = InferParams<typeof params>

export default class NextAddTask extends Command {
  static override description: CommandDescription = {
    name: 'next:add',
    description: 'Add a task to a list.',
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult> {
    const { config, output } = context
    const { task, category, link } = args

    const nextContents = await readTextFile(<string>config.FILE_NEXT_PROFESSIONAL)
    const nextActionsDoc = ListDocument.fromMarkdown(nextContents)

    const list = nextActionsDoc.lists.find((list) => list.title === category)
    if (!list) {
      output.error('Cannot find list Next.')
      return CommandResult.error('Cannot find list Next.')
    }

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

    const newDoc = nextActionsDoc.addItem(category, taskWithLink, { links: linkMap })

    await writeTextFile(<string>config.FILE_NEXT_PROFESSIONAL, newDoc.toMarkdown())

    return CommandResult.success()
  }
}
