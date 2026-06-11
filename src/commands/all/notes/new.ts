import { setTimeout as delay } from 'node:timers/promises'
import * as path from 'node:path'
import { copyFile, mkdir, rename } from 'node:fs/promises'
import openEditor from 'open-editor'
import colors from 'picocolors'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import { DayDirFileWriter, writeDayItems } from '#lib/nbfs/mod.ts'
import { ArgOrFlag, categoryComplete, Command, CommandResult, Flag, whenNBTime } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import slugify from '#lib/string/slugify.ts'
import dayAttachmentsDir from '#shared/nbfs/dayAttachmentsDir.ts'

const params = {
  summary: ArgOrFlag.string('Summary / Header of Notes', { short: 's', optional: true }),
  fromAudio: Flag.string('Path to audio file, or omit path to search Desktop', {
    short: 'a',
    optional: true,
  }),
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

  async run({ args, context, tasks }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output, config } = context
    let { summary, when, category, fromAudio } = args
    let body = ''
    let rel: string[] | undefined
    let attachmentFile: string | undefined

    const useAudioPipeline = fromAudio !== undefined

    if (useAudioPipeline) {
      const summaryResult = await tasks.run('audio:transcript:summary', {
        fromAudio,
        summaryPrompt: new URL('./prompts/audio-summary.prompt.md', import.meta.url).pathname,
        extractPrompt: new URL('./prompts/audio-extract.prompt.md', import.meta.url).pathname,
      })
      if (!summaryResult.ok || !summaryResult.data) {
        return CommandResult.fail(`Audio pipeline failed: ${summaryResult.message}`)
      }

      const data = summaryResult.data
      if (!summary) summary = data.title
      const merged = Array.from(new Set([...data.who, ...data.rel]))
      if (merged.length > 0) rel = merged
      if (data.time) when = new PlainDateTime(data.time)

      body = `## Summary\n\n${data.body}\n\n## Transcript\n\n${data.cleanedText}\n`

      output.log(`\nExtracted: summary="${summary}", when="${when}"`)
      if (rel && rel.length > 0) {
        output.log(`  Related: ${rel.join(', ')}`)
      }
      output.log('')

      if (data.audioFilePath) {
        const audioPath = data.audioFilePath
        const noteDate = when.plainDate
        const summarySlugPart = `_${slugify(summary as string, { preserveCase: true, suggestedLength: 40 })}`
        const attachDir = path.join(config.DIR_ATTACHMENTS as string, dayAttachmentsDir(noteDate))
        await mkdir(attachDir, { recursive: true })

        const ext = path.extname(audioPath)
        const newFileName = `${noteDate}_notes${summarySlugPart}${ext}`
        const destPath = path.join(attachDir, newFileName)

        await rename(audioPath, destPath).catch(async () => {
          await copyFile(audioPath, destPath)
        })

        attachmentFile = newFileName
        output.log(colors.gray(`Moved audio file to ${attachDir}\n`))
      }
    }

    if (!summary) {
      return CommandResult.fail('Missing required argument: summary (or use --from-audio)')
    }

    const whenDate = when.plainDate
    const summarySlug = slugify(summary, { suggestedLength: 40, preserveCase: true })

    const fileName = `actions/notes/${summarySlug}.md`

    const ddfw = new DayDirFileWriter(whenDate)
    const entryWhen = when.time

    const yamlLines: string[] = ['---', `summary: ${summary}`, `when: ${entryWhen}`, `type: Notes`, 'context:']

    if (rel && rel.length > 0) {
      yamlLines.push('rel:')
      for (const r of rel) yamlLines.push(`  - ${r}`)
    } else {
      yamlLines.push('rel:')
    }

    yamlLines.push('tags:')

    if (attachmentFile) {
      yamlLines.push('attachments:')
      yamlLines.push(`  - file: ${attachmentFile}`)
    }

    yamlLines.push('---', '', `# ${summary}`, '')
    yamlLines.push(body || '')

    const data = yamlLines.join('\n')

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
