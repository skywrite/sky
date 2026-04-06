import * as path from 'node:path'
import OpenAI from 'openai'
import { readTextFile, writeTextFile } from '#shared/fs/mod.ts'
import { slugify } from '#lib/string/mod.ts'
import { dayFile } from '#lib/nbfs/mod.ts'
import DayDocument from '#shared/models/Day/mod.ts'
import { Link } from '#shared/models/Markdown/Link/mod.ts'
import { ArgOrFlag, Command, CommandResult, dayFlag, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'

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
    const { config, env, output } = context
    const { task, link, when } = args

    const file = path.join(<string>config.DIR_TIME, dayFile(when))
    const contents = await readTextFile(file)
    let dayObj = DayDocument.fromMarkdown(contents)

    let linkMap: Map<string, Link> | undefined = undefined
    let taskWithLink = task
    if (link) {
      const commandDesc = slugify(await openAIShortenDescription(task, env.OPENAI_API_KEY), { suggestedLength: 40 })

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

async function openAIShortenDescription(desc: string, apiKey: string): Promise<string> {
  const prompt = `
  Remove all unncessary words and puncuation from the following statement and shorten to 3 to 5 words maximum.

  Remove words that do not have semantic meaning e.g. "on", "the", "to", "from", etc.

  Try to include People's names.

  Keep only three to five words MAXIMUM.

  ONLY OUTPUT THE REVISED STATEMENT. NO OTHER WORDS.

  COMPARE YOUR NEW STATEMENT TO THE ORIGINAL. NO NEW WORDS.

  ${desc}
  `

  const openai = new OpenAI({ apiKey })
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    messages: [{ role: 'user', content: prompt }],
  })

  const dataRes = response.choices[0]?.message?.content as string
  return dataRes
}
