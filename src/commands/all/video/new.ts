import { copyFile, mkdir, rename } from 'node:fs/promises'
import * as path from 'node:path'
import * as p from '@clack/prompts'
import colors from 'picocolors'
import { desktopFilesByExt } from '#commands/all/audio/transcript/lib/desktopFiles.ts'
import { validateAnyArgFlagExists } from '#commands/cli/mod.ts'
import type { OutputHandler } from '#commands/lib/output/OutputHandler.ts'
import { ArgOrFlag, categoryComplete, Command, CommandResult, Flag, whenNBTime } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { DayDirFileWriter, writeDayItems } from '#lib/nbfs/mod.ts'
import openEditor from '#lib/shell/openEditor.ts'
import slugify from '#lib/string/slugify.ts'
import VideoDocument from '#shared/models/Video/mod.ts'
import dayAttachmentsDir from '#shared/nbfs/dayAttachmentsDir.ts'
import { isTerminal } from '#shared/sys/mod.ts'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'

const params = {
  summary: ArgOrFlag.string('Summary of the video (optional with --from-srt)', { short: 's' }),
  medium: Flag.string('Video platform/medium (YouTube, Vimeo, Loom, etc.)', { short: 'm' }),
  from: Flag.string('Who the communication was from', { short: 'f' }),
  to: Flag.string('Who the communication was to', { short: 't' }),
  fromSrt: Flag.string('Path to an .srt transcript, or omit path to use the newest .srt on the Desktop', {
    optional: true,
  }),
  when: whenNBTime(),
  category: categoryComplete(),
}

type Params = InferParams<typeof params>
type Result = { filePath: string }

const VIDEO_MEDIUMS = ['Loom', 'YouTube', 'Zoom Recording', 'Google Meet Recording', 'Vimeo', 'Video']

export default class VideoNewTask extends Command {
  static override description: CommandDescription = {
    name: 'video:new',
    description: 'Create new video entry.',
    usage: [
      'sky video:new "Weekly update" --from Jane --medium Loom',
      'sky video:new --from-srt                    # Summarize newest .srt on Desktop',
      'sky video:new --from-srt ~/Desktop/talk.srt # Summarize a specific transcript',
    ],
    params,
    postProcess: [validateAnyArgFlagExists('summary', 'fromSrt')],
  }

  async run({ args, context, tasks }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output, config } = context
    let { medium, from, to, when, summary, category } = args
    const { fromSrt } = args
    let body: string | undefined
    let rel: string[] | undefined
    let srtSourcePath: string | null = null

    // --from-srt pipeline: clean + summarize the transcript via audio:transcript:summary.
    // The 'audio-message' template is the one-way-communication shape (from/to rather
    // than a shared attendee list), which is what a recorded video is.
    if (fromSrt !== undefined) {
      const resolved = await this.resolveSrtPath(fromSrt, output)
      if (!resolved.ok) return CommandResult.fail(resolved.message)
      srtSourcePath = resolved.path
      output.log(colors.cyan(`Using transcript: ${path.basename(srtSourcePath)}`))

      const summaryResult = await tasks.run('audio:transcript:summary', {
        fromZoomVtt: srtSourcePath,
        template: 'audio-message',
      })
      if (!summaryResult.ok || !summaryResult.data) {
        return CommandResult.fail(`Transcript pipeline failed: ${summaryResult.message}`)
      }

      const data = summaryResult.data

      // Explicit flags win over anything the model inferred.
      if (!from) from = data.from ?? undefined
      if (!to) to = data.to ?? undefined
      if (!summary) summary = data.title
      if (data.rel.length > 0) rel = data.rel
      if (data.time) when = new PlainDateTime(data.time)

      // The transcript is the point of the import, so it goes in the body under the
      // AI summary — which is also what makes it reachable by `bodyContains` queries.
      body = `${data.body}\n\n## Transcript\n\n${data.cleanedText}`

      // The extract prompt is tuned for calls and messages, so it offers mediums like
      // "Phone" that make no sense for a recording. Ask instead of guessing.
      if (!medium && isTerminal()) {
        const selected = await p.select({
          message: 'Which video platform?',
          options: VIDEO_MEDIUMS.map((m) => ({ value: m, label: m })),
        })
        if (p.isCancel(selected)) {
          p.cancel('Cancelled.')
          return CommandResult.fail('Cancelled')
        }
        medium = selected
      }

      output.log(`\nExtracted: from="${from ?? ''}", to="${to ?? ''}", summary="${summary}", when="${when}"`)
      if (rel && rel.length > 0) output.log(`  Related: ${rel.join(', ')}`)
      output.log('')
    }

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
    // On the --from-srt path the AI summary + transcript replace the empty template.
    const templateBody = [`# ${mediumValue}`, '', '## Summary', '', '(insert summary here)', '', '## Transcript'].join(
      '\n',
    )
    const finalBody = body ? `# ${mediumValue}\n\n${body}` : templateBody

    // Move the source transcript into the day's attachments so the notebook owns it.
    // A failure here must not lose the summary the AI pipeline just produced, so it
    // degrades to a warning — same tradeoff meeting:new makes.
    // A null file is the placeholder the manual path has always written for the user
    // to fill in, so this is deliberately looser than the Attachment type.
    let attachments: Array<{ file: string | null }> = [{ file: null }]
    if (srtSourcePath) {
      const sourcePath = srtSourcePath
      const attachDir = path.join(config.DIR_ATTACHMENTS as string, dayAttachmentsDir(whenDate))
      const attachmentFile = `${whenDate}_${mediumValue}_${partialSlug}${path.extname(sourcePath)}`
      const destPath = path.join(attachDir, attachmentFile)

      try {
        await mkdir(attachDir, { recursive: true })
        await rename(sourcePath, destPath).catch(async () => {
          await copyFile(sourcePath, destPath)
        })
        attachments = [{ file: attachmentFile }]
        output.log(colors.gray(`  Imported transcript to ${destPath}\n`))
      } catch (err) {
        output.error(`Failed to import transcript ${sourcePath}: ${(err as Error).message}`)
      }
    }

    const video = new VideoDocument({
      ...(from && { from }),
      ...(to && { to }),
      when,
      medium: mediumValue,
      summary: summary || '',
      attachments,
      ...(rel && rel.length > 0 ? { rel } : {}),
      body: finalBody,
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

  /**
   * Resolve --from-srt to a file. A valueless flag arrives as the string "true" at
   * runtime, which means "search the Desktop".
   *
   * Searches for .srt only, rather than delegating to the pipeline's Desktop lookup:
   * that one accepts .vtt too, so a newer meeting VTT sitting on the Desktop would
   * quietly win over the .srt the user asked for.
   */
  private async resolveSrtPath(
    fromSrt: string,
    output: OutputHandler,
  ): Promise<{ ok: true; path: string } | { ok: false; message: string }> {
    if (typeof fromSrt === 'string' && fromSrt !== 'true') {
      return { ok: true, path: path.resolve(fromSrt) }
    }

    const found = await desktopFilesByExt(['.srt'])
    if (found.length === 0) {
      return { ok: false, message: 'No .srt file found on Desktop. Specify a path: --from-srt /path/to/transcript.srt' }
    }
    if (found.length > 1) {
      output.log(colors.gray(`${found.length} .srt files on Desktop, using newest`))
    }
    return { ok: true, path: found[0].path }
  }
}
