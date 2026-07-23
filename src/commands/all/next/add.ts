import { ArgOrFlag, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import ollama from 'ollama'
import OpenAI from 'openai'
import { readTextFile, writeTextFile } from '#shared/fs/mod.ts'
import { slugify } from '#lib/string/mod.ts'
import ListDocument from '#shared/models/Markdown/ListDocument/mod.ts'
import type { Link } from '#shared/models/Markdown/Link/mod.ts'

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
    const { config, env, output } = context
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

    const newDoc = nextActionsDoc.addItem(category, taskWithLink, { links: linkMap })

    await writeTextFile(<string>config.FILE_NEXT_PROFESSIONAL, newDoc.toMarkdown())

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
