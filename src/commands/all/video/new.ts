import * as path from 'node:path'
import openEditor from '#lib/shell/openEditor.ts'
import { DayDirFileWriter, writeDayItems } from '#lib/nbfs/mod.ts'
import slugify from '#lib/string/slugify.ts'
import { ArgOrFlag, categoryComplete, Command, CommandResult, Flag, whenNBTime } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import VideoDocument from '#shared/models/Video/mod.ts'

const params = {
  summary: ArgOrFlag.string('Summary of the video', { short: 's', required: true }),
  medium: Flag.string('Video platform/medium (YouTube, Vimeo, Loom, etc.)', { short: 'm' }),
  from: Flag.string('Who the communication was from', { short: 'f' }),
  to: Flag.string('Who the communication was to', { short: 't' }),
  when: whenNBTime(),
  category: categoryComplete(),
}

type Params = InferParams<typeof params>
type Result = { filePath: string }

export default class VideoNewTask extends Command {
  static override description: CommandDescription = {
    name: 'video:new',
    description: 'Create new video entry.',
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context
    const { medium, from, to, when, summary, category } = args

    const whenDate = when.plainDate
    const mediumValue = medium || 'Video'

    // Build filename slug from available info
    const whoSlug = from ? slugify(from, { preserveCase: true }) : to ? slugify(to, { preserveCase: true }) : ''
    const summarySlug = slugify(summary || '', { preserveCase: true, suggestedLength: 40 })
    const partialSlug = whoSlug && summarySlug ? `${whoSlug}_${summarySlug}` : whoSlug || summarySlug
    const fileName = `actions/videos/${mediumValue}_${partialSlug}.md`

    const ddfw = new DayDirFileWriter(whenDate)

    let entryWho = ''
    if (from && to) {
      entryWho = `${from} to ${to}`
    } else if (from) {
      entryWho = from
    } else if (to) {
      entryWho = to
    }

    // The document's default template heads the body with "# Video"; this command
    // has always used the medium instead ("# Loom", "# YouTube"), so pass a body.
    const body = [`# ${mediumValue}`, '', '## Summary', '', '(insert summary here)', '', '## Transcript'].join('\n')

    const video = new VideoDocument({
      ...(from && { from }),
      ...(to && { to }),
      when,
      medium: mediumValue,
      summary: summary || '',
      attachments: [{ file: null }],
      body,
    })

    // toMarkdown() has no trailing newline; video files have always ended with one.
    const data = video.toMarkdown() + '\n'

    const filePath = await ddfw.write(fileName, data)

    const dayItemParts = [when.time, '>']
    if (entryWho) {
      dayItemParts.push(entryWho)
    }
    dayItemParts.push(mediumValue, '->', `[${summary || ''}](${filePath})`)
    const dayItem = dayItemParts.join(' ')
    await writeDayItems(whenDate, category, dayItem)

    await openEditor([{ file: path.join(ddfw.fullDir, filePath), line: data.split('\n').length }])

    output.log(`\n  Successfully created ${filePath}.\n`)

    return CommandResult.success({ filePath })
  }
}
