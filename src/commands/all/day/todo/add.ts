import * as path from 'node:path'
import ollama from 'ollama'
import OpenAI from 'openai'
import { exists, readTextFile, writeTextFile } from '#shared/fs/mod.ts'
import { slugify } from '#lib/string/mod.ts'
import { dayFile } from '#lib/nbfs/mod.ts'
import ListDocument from '#shared/models/Markdown/ListDocument/mod.ts'
import ItemList from '#shared/models/Markdown/ItemList/mod.ts'
import type { Link } from '#shared/models/Markdown/Link/mod.ts'
import { ArgOrFlag, categoryTodo, Command, CommandResult, dayFlag, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'

const params = {
  task: ArgOrFlag.string('Task to add', { short: 't', required: true }),
  category: categoryTodo(),
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
    const { config, env, output } = context
    const { task, category, link, when } = args

    let linkMap: Map<string, Link> | undefined = undefined
    let taskWithLink = task
    if (link) {
      // const commandDesc = slugify(await ollamaShortenDescription(task), { suggestedLength: 40 })
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

    const file = path.join(<string>config.DIR_TIME, dayFile(when))
    const fileExists = await exists(file)

    if (!fileExists) {
      const scheduleFile = category.startsWith('Personal')
        ? config.FILE_SCHEDULE_PERSONAL
        : config.FILE_SCHEDULE_PROFESSIONAL

      const contents = await readTextFile(scheduleFile as string)
      const doc = ListDocument.fromMarkdown(contents)
      const dateStr = when.ymd

      const existingIndex = doc.findListIndex((list) => list.title === dateStr)

      let docWithDateList = doc
      if (existingIndex < 0) {
        const emptyList = new ItemList(dateStr)
        const insertIndex = doc.findListIndex((list) => list.title > dateStr)
        docWithDateList = doc.insertList(insertIndex < 0 ? doc.lists.length : insertIndex, emptyList)
      }

      const newDoc = docWithDateList.addItem(dateStr, taskWithLink, { links: linkMap })

      await writeTextFile(scheduleFile as string, newDoc.toMarkdown())
      output.log(`Added to schedule (day file does not exist yet)`)
      return CommandResult.success()
    }

    const contents = await readTextFile(file)
    const doc = ListDocument.fromMarkdown(contents)
    const newDoc = doc.addItem(category, taskWithLink, { links: linkMap })

    await writeTextFile(file, newDoc.toMarkdown())
    return CommandResult.success()
  }
}

async function ollamaShortenDescription(desc: string): Promise<string> {
  const prompt = `
  Remove all unncessary words and puncuation from the following statement and shorten to 3 to 5 words maximum.

  Remove words that do not have semantic meaning e.g. "on", "the", "to", "from", etc.

  Try to include People's names.

  Keep only three to five words MAXIMUM.

  ONLY OUTPUT THE REVISED STATEMENT. NO OTHER WORDS.

  COMPARE YOUR NEW STATEMENT TO THE ORIGINAL. NO NEW WORDS.

  ${desc}
  `

  const response = await ollama.chat({
    model: 'llama3.2:3b', // ultimately switched to ChatGPT because these small models still suck
    messages: [{ role: 'user', content: prompt }],
    options: {
      temperature: 0,
    },
  })

  return response.message.content
}

async function openAIShortenDescription(desc: string, apiKey): Promise<string> {
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
    // response_format: { type: 'json_object' },
    messages: [{ role: 'user', content: prompt }],
  })

  const dataRes = response.choices[0]?.message?.content as string
  return dataRes
}
