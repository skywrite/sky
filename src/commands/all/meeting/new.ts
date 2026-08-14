import { copyFile, mkdir, rename } from 'node:fs/promises'
import * as path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import openEditor from 'open-editor'
import { Arg, categoryComplete, Command, CommandResult, Flag, whenNBTime } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { DayDirFileWriter, meetingFileName, writeDayItems } from '#lib/nbfs/mod.ts'
import { autoRelMessage, mergeRel } from '#lib/notebook/enrich/autoRel.ts'
import { autoTagMessage } from '#lib/notebook/enrich/autoTag.ts'
import slugify from '#lib/string/slugify.ts'
import { MCPTool } from '#mcp/decorators.ts'
import type { Attachment } from '#shared/models/Markdown/Document/attachment.ts'
import MeetingDocument from '#shared/models/Meeting/mod.ts'
import dayAttachmentsDir from '#shared/nbfs/dayAttachmentsDir.ts'
import { PlainDateTime, When } from '#universal/dates/nbdt/mod.ts'

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
  duration: Flag.string('Meeting length e.g. 45m, 2h', { short: 'd', optional: true }),
  category: categoryComplete(),
  medium: Flag.string('Meeting medium e.g. Zoom, Phone, etc', { short: 'm', default: () => 'Zoom' }),
  summary: Flag.string('Meeting summary', { short: 's', default: () => '' }),
  noAutoTag: Flag.bool('Skip automatic tagging from the archived-meeting tag corpus', { default: false }),
  noAutoRel: Flag.bool('Skip automatic rel suggestion from the entity graph', { default: false }),
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
    let { when, medium, who, summary, category, fromAudio, fromTranscript, duration } = args
    let body: string | undefined
    let rel: string[] | undefined
    let tags: string | undefined
    let transcriptSourcePath: string | null = null

    if (fromAudio !== undefined && fromTranscript !== undefined) {
      return CommandResult.fail('Use either --from-audio or --from-transcript, not both')
    }

    // Check the length here rather than at write time: the transcript pipeline
    // below can run for minutes, and a typo shouldn't surface only after it.
    if (duration !== undefined) {
      try {
        When.from(when, duration)
      } catch {
        return CommandResult.fail(`Invalid --duration "${duration}" — use a single-unit length like 45m, 2h or 90s`)
      }
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

      // A transcript knows a length, not an end time, so that's the spelling
      // `when:` keeps. Anything under a minute rounds to zero, which carries no
      // length at all rather than a false one. An explicit --duration wins.
      if (duration === undefined && data.durationMinutes !== null && data.durationMinutes >= 1) {
        duration = `${Math.round(data.durationMinutes)}m`
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

      output.log(
        `\nExtracted: who="${who}", summary="${summary}", when="${When.from(when, duration)}", medium="${medium}"`,
      )
      if (rel && rel.length > 0) {
        output.log(`  Related: ${rel.join(', ')}`)
      }

      // Enrich from the archived-meeting corpus. Auto-rel runs alongside the
      // transcript's own extraction rather than instead of it: the pipeline
      // reads corrections and the glossary, so it catches names the entity
      // graph cannot, while this pass adds graph-validated refs it missed.
      // Attendees key the history prior — a recurring meeting tends to be
      // filed the way it was filed last time.
      const enrichInput = { to: who, summary, body: body ?? '' }
      const [autoTags, autoRel] = await Promise.all([
        args.noAutoTag ? undefined : autoTagMessage(enrichInput, { mediums: ['meeting'], kind: 'meeting' }),
        args.noAutoRel ? undefined : autoRelMessage(enrichInput, { mediums: ['meeting'], kind: 'meeting' }),
      ])
      tags = autoTags
      if (autoTags) output.log(`  Auto-tags: ${autoTags}`)
      const merged = mergeRel(rel, autoRel)
      if (autoRel && merged && merged.length > (rel?.length ?? 0)) {
        output.log(`  Auto-rel: ${merged.slice(rel?.length ?? 0).join(', ')}`)
      }
      rel = merged

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
    const meeting = new MeetingDocument({
      who,
      when: When.from(when, duration),
      medium,
      summary,
      body,
      rel,
      tags,
      attachments,
    })

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
