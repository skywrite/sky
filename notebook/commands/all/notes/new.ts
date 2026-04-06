import { setTimeout as delay } from 'node:timers/promises'
import * as path from 'node:path'
import openEditor from 'open-editor'
import { DayDirFileWriter, writeDayItems } from '#lib/nbfs/mod.ts'
import { ArgOrFlag, categoryComplete, Command, CommandResult, whenNBTime } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import slugify from '#lib/string/slugify.ts'

const params = {
  summary: ArgOrFlag.string('Summary / Header of Notes', { short: 's', required: true }),
  when: whenNBTime(),
  category: categoryComplete(),
}

type Params = InferParams<typeof params>
type Result = { filePath: string }

export default class NotesNewTask extends Command {
  static override description: CommandDescription = {
    name: 'notes:new',
    description: 'Create new note.',
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context
    const { summary, when, category } = args

    const whenDate = when.plainDate
    const summarySlug = slugify(summary, { suggestedLength: 40, preserveCase: true })

    const fileName = `actions/notes/${summarySlug}.md`

    const ddfw = new DayDirFileWriter(whenDate)
    const entryWhen = when.time

    const data = [
      '---',
      `summary: ${summary}`,
      `when: ${entryWhen}`,
      `type: Notes`,
      'context:',
      `rel:`,
      `tags:`,
      `---`,
      '',
      `# ${summary}`,
      '',
      '',
    ].join('\n')

    let filePath
    try {
      filePath = await ddfw.write(fileName, data.trimStart())
    } catch (err) {
      return CommandResult.error(err as Error, 'Failed to write note file')
    }

    // add entry to Day
    try {
      const dayItem = `${entryWhen} > Notes -> [${summary}](${filePath})`
      await writeDayItems(whenDate, category, dayItem)
    } catch (err) {
      return CommandResult.error(err as Error, 'Failed to write day item')
    }

    openEditor([{ file: path.join(ddfw.fullDir, filePath), line: data.split('\n').length }])
    await delay(500)

    output.log(`\n  Successfully created ${filePath}.\n`)

    return CommandResult.success({ filePath })
  }
}
