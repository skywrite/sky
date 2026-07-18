import * as path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import openEditor from 'open-editor'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import { DayDirFileWriter, writeDayItems } from '#lib/nbfs/mod.ts'
import MeetingDocument from '#shared/models/Meeting/mod.ts'
import slugify from '#lib/string/slugify.ts'
import { Arg, categoryComplete, Command, CommandResult, Flag, whenNBTime } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { MCPTool } from '#mcp/decorators.ts'

const params = {
  who: Arg.string('Person or group (optional with --from-audio/--from-transcript)', { optional: true }),
  fromAudio: Flag.string('Path to audio file, or omit path to search Desktop', {
    short: 'a',
    optional: true,
  }),
  fromTranscript: Flag.string('Path to transcript file, or omit to use the newest .vtt on the Desktop', {
    short: 't',
    optional: true,
  }),
  when: whenNBTime(),
  category: categoryComplete(),
  medium: Flag.string('Meeting medium e.g. Zoom, Phone, etc', { short: 'm', default: () => 'Zoom' }),
  summary: Flag.string('Meeting summary', { short: 's', default: () => '' }),
}

type Params = InferParams<typeof params>
type Result = { file: string }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'meeting:new': { params: Params; result: Result }
  }
}

@MCPTool()
export default class MeetingNewTask extends Command {
  static override description: CommandDescription = {
    name: 'meeting:new',
    description: 'Create new Meeting.',
    params,
  }

  async run({ args, context, tasks }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context
    let { when, medium, who, summary, category, fromAudio, fromTranscript } = args
    let body: string | undefined
    let rel: string[] | undefined

    if (fromAudio !== undefined && fromTranscript !== undefined) {
      return CommandResult.fail('Use either --from-audio or --from-transcript, not both')
    }

    // Handle --from-audio / --from-transcript pipeline via audio:transcript:summary
    const usePipeline = fromAudio !== undefined || fromTranscript !== undefined

    if (usePipeline) {
      // Delegate to audio:transcript:summary which handles:
      // (audio: transcribe →) clean → summarize with user corrections
      const summaryResult = await tasks.run(
        'audio:transcript:summary',
        fromAudio !== undefined ? { fromAudio } : { fromTranscript },
      )
      if (!summaryResult.ok || !summaryResult.data) {
        return CommandResult.fail(`Transcript pipeline failed: ${summaryResult.message}`)
      }

      const data = summaryResult.data

      // Extract meeting data from results
      who = data.who.length > 0 ? data.who.join(', ') : 'Unknown'
      summary = data.title
      body = data.body
      rel = data.rel.length > 0 ? data.rel : undefined

      // Parse time from summary if available
      if (data.time) {
        when = new PlainDateTime(data.time)
      }

      // Use extracted medium if available
      if (data.medium) {
        medium = data.medium
      }

      output.log(`\nExtracted: who="${who}", summary="${summary}", when="${when}", medium="${medium}"`)
      if (rel && rel.length > 0) {
        output.log(`  Related: ${rel.join(', ')}`)
      }
      output.log('')
    }

    // Validate required fields for manual path
    if (!who) {
      return CommandResult.fail('Missing required argument: who (or use --from-audio/--from-transcript)')
    }

    const whenDate = when.plainDate
    const entryWhen = when.time
    const whoSlug = slugify(who, { preserveCase: true, suggestedLength: 30 })
    let fileSlug = whoSlug

    if (summary) fileSlug += `_${slugify(<string>summary, { suggestedLength: 40, preserveCase: true })}`

    // only one that matters is "In Person"
    fileSlug = slugify(medium, { preserveCase: true }) + '_' + fileSlug

    const meetingFileName = `actions/meetings/${fileSlug}.md`

    const ddfw = new DayDirFileWriter(whenDate)
    const meeting = new MeetingDocument({ who, when, medium, summary, body, rel })

    const data = meeting.toMarkdown()

    let file: string
    try {
      file = await ddfw.write(meetingFileName, data)
    } catch (err) {
      return CommandResult.error(err as Error, 'Failed to write meeting file')
    }

    try {
      const dayItem = `${entryWhen} > ${who} ${medium} -> [${summary}](${file})`
      await writeDayItems(whenDate, category, dayItem)
    } catch (err) {
      return CommandResult.error(err as Error, 'Failed to write day item')
    }

    openEditor([{ file: path.join(ddfw.fullDir, file), line: data.split('\n').length }])
    await delay(500)

    output.log(`\n  Successfully created meeting ${file}.\n`)

    return CommandResult.success({ file })
  }
}
