import { copyFile, mkdir, rename } from 'node:fs/promises'
import * as path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import openEditor from 'open-editor'
import { Arg, categoryComplete, Command, CommandResult, Flag, whenNBTime } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { DayDirFileWriter, meetingFileName, writeDayItems } from '#lib/nbfs/mod.ts'
import slugify from '#lib/string/slugify.ts'
import { MCPTool } from '#mcp/decorators.ts'
import type { Attachment } from '#shared/models/Markdown/Document/attachment.ts'
import MeetingDocument from '#shared/models/Meeting/mod.ts'
import dayAttachmentsDir from '#shared/nbfs/dayAttachmentsDir.ts'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'

const params = {
  who: Arg.string('Person or group (optional with --from-audio/--from-transcript)', { optional: true }),
  fromAudio: Flag.string('Path to audio file, or omit path to search Desktop', {
    short: 'a',
    optional: true,
  }),
  fromTranscript: Flag.string('Path to transcript file, or omit to use the newest .vtt/.srt on the Desktop', {
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
    const { output, config } = context
    let { when, medium, who, summary, category, fromAudio, fromTranscript } = args
    let body: string | undefined
    let rel: string[] | undefined
    let transcriptSourcePath: string | null = null

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

      // Only --from-transcript hands us a file worth keeping: on the --from-audio
      // path the .vtt is a generated artifact, and the recording it came from is
      // the file that matters.
      if (fromTranscript !== undefined) {
        transcriptSourcePath = data.transcriptFilePath
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
    const summarySlug = summary ? slugify(<string>summary, { suggestedLength: 40, preserveCase: true }) : ''

    // only one that matters is "In Person"
    const mediumSlug = slugify(medium, { preserveCase: true })

    // Shared by the meeting file and the imported transcript, so the two names
    // still read as a pair in their separate directories.
    const fileSlug = [mediumSlug, whoSlug, summarySlug].filter(Boolean).join('_')

    const fileName = meetingFileName(when, fileSlug)

    // Move the source transcript into the day's attachments so the notebook owns it,
    // then point the meeting file at it. A failure here must not lose the summary the
    // AI pipeline just produced, so it degrades to a warning.
    let attachments: Attachment[] | undefined
    if (transcriptSourcePath) {
      const sourcePath = transcriptSourcePath
      const attachDir = path.join(config.DIR_ATTACHMENTS as string, dayAttachmentsDir(whenDate))
      const attachmentFile = `${whenDate}_${fileSlug}${path.extname(sourcePath)}`
      const destPath = path.join(attachDir, attachmentFile)

      try {
        await mkdir(attachDir, { recursive: true })
        await rename(sourcePath, destPath).catch(async () => {
          await copyFile(sourcePath, destPath)
        })
        attachments = [{ file: attachmentFile }]
        output.log(`  Imported transcript to ${destPath}\n`)
      } catch (err) {
        output.error(`Failed to import transcript ${sourcePath}: ${(err as Error).message}`)
      }
    }

    const ddfw = new DayDirFileWriter(whenDate)
    const meeting = new MeetingDocument({ who, when, medium, summary, body, rel, attachments })

    const data = meeting.toMarkdown()

    let file: string
    try {
      file = await ddfw.write(fileName, data)
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
