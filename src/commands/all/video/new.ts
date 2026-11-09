import { copyFile, mkdir, rename } from 'node:fs/promises'
import * as path from 'node:path'
import colors from 'picocolors'
import { desktopFilesByExt } from '#commands/all/audio/transcript/lib/desktopFiles.ts'
import { clockLabel, runOptionsFor, TranscriptRun } from '#commands/all/audio/transcript/lib/transcriptRun.ts'
import { validateAnyArgFlagExists } from '#commands/cli/mod.ts'
import type { OutputHandler } from '#commands/lib/output/OutputHandler.ts'
import {
  ArgOrFlag,
  categoryComplete,
  Command,
  CommandPlatform,
  CommandResult,
  Flag,
  whenNBTime,
} from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { DayDirFileWriter, writeDayItems } from '#lib/nbfs/mod.ts'
import { autoRelMessage, mergeRel } from '#lib/notebook/enrich/autoRel.ts'
import { autoTagMessage } from '#lib/notebook/enrich/autoTag.ts'
import openEditor from '#lib/shell/openEditor.ts'
import VideoDocument from '#shared/models/Video/mod.ts'
import dayAttachmentsDir from '#shared/nbfs/dayAttachmentsDir.ts'
import { actionKindRel } from '#shared/nbfs/mod.ts'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import { videoAttachmentName, videoFileStem } from './lib/fileNames.ts'
import { importVideo, type VideoImportPlan, videoSource } from './lib/importVideo.ts'

const params = {
  url: Flag.string('Source video URL; an existing Loom ID fills only missing content', { optional: true }),
  videoFile: Flag.string('Local recording to attach during import', { optional: true }),
  recordedAt: Flag.string('Original recording instant, including timezone, retained with the source URL', {
    optional: true,
  }),
  fromText: Flag.string('Path to a plain TXT transcript', { optional: true }),
  acceptAllReviews: Flag.bool('Accept suggested name corrections and write-ups for this import', { default: false }),
  dryRun: Flag.bool('Show the source match and missing content without model calls or writes', { default: false }),
  summary: ArgOrFlag.string('Summary of the video (optional with --from-srt or --from-zoom-vtt)', { short: 's' }),
  medium: Flag.string('Video platform/medium (YouTube, Vimeo, Loom, etc.)', { short: 'm' }),
  from: Flag.string('Who the communication was from', { short: 'f' }),
  to: Flag.string('Who the communication was to', { short: 't' }),
  fromSrt: Flag.string('Path to an .srt transcript, or omit path to use the newest .srt on the Desktop', {
    optional: true,
  }),
  fromZoomVtt: Flag.string(
    "Path to a Zoom transcript — a Zoom Clip's .vtt — or omit path to use the newest .vtt on the Desktop",
    { optional: true },
  ),
  when: whenNBTime(),
  category: categoryComplete(),
  noAutoTag: Flag.bool('Skip automatic tagging from the archived-video tag corpus', { default: false }),
  noAutoRel: Flag.bool('Skip automatic rel suggestion from the entity graph', { default: false }),
  fresh: Flag.bool('Start over: forget what an earlier run of the transcript already produced', { default: false }),
  run: Flag.string('Run record key, passed by a host that keyed the file itself', { optional: true, hidden: true }),
  clock: Flag.string(
    "The start the file's clock gives, in notebook time, passed by a host that read the file; sky's reading, not the caller's, so a time the transcript states wins over it",
    { optional: true, hidden: true },
  ),
}

type Params = InferParams<typeof params>
/** The video's absolute path: the day it went under is the pipeline's to settle, not the caller's */
type Result = { filePath: string | null; plan?: VideoImportPlan }

const VIDEO_MEDIUMS = ['Loom', 'Zoom Clip', 'YouTube', 'Zoom Recording', 'Google Meet Recording', 'Vimeo', 'Video']

// Videos classify against the video archive alone: a closed menu of tags
// already on videos, and rel exemplars from earlier videos. See docs/README.md.
const VIDEO_ENRICH: { mediums: string[]; kind: string } = { mediums: ['video'], kind: 'video recording' }

export default class VideoNewTask extends Command {
  static override description: CommandDescription = {
    name: 'video:new',
    description: 'Create new video entry.',
    usage: [
      'sky video:new "Weekly update" --from Jane --medium Loom',
      'sky video:new --from-srt                    # Summarize newest .srt on Desktop',
      'sky video:new --from-srt ~/Desktop/talk.srt # Summarize a specific transcript',
      "sky video:new --from-zoom-vtt               # Summarize newest .vtt on Desktop, a Zoom Clip's",
    ],
    params,
    postProcess: [validateAnyArgFlagExists('summary', 'fromSrt', 'fromZoomVtt', 'fromText', 'url')],
  }

  async run({ args, context, tasks, rawArgs }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output, config } = context
    let { medium, from, to, when, summary, category } = args
    const { fromSrt, fromZoomVtt } = args
    let body: string | undefined
    let rel: string[] | undefined
    let tags: string | undefined
    let transcriptPath: string | null = null
    /** The pipeline's run record for the transcript, forgotten once the video is filed */
    let run: TranscriptRun | null = null

    if ([args.fromSrt, args.fromZoomVtt, args.fromText].filter((value) => value !== undefined).length > 1)
      return CommandResult.fail('Use only one of --from-srt, --from-zoom-vtt or --from-text')

    if (args.url) {
      const format = args.fromSrt !== undefined ? '.srt' : args.fromZoomVtt !== undefined ? '.vtt' : '.txt'
      const source = args.fromSrt ?? args.fromZoomVtt ?? args.fromText
      const resolved = source !== undefined ? await this.resolveTranscriptPath(format, source, output) : null
      if (resolved && !resolved.ok) return CommandResult.fail(resolved.message)
      let completedRun: string | null = null
      try {
        const result = await importVideo({
          config,
          url: args.url,
          when,
          recordedAt: args.recordedAt,
          timezone: context.systemNow.timezone,
          title: summary,
          medium: medium || (videoSource(args.url).loomId ? 'Loom' : 'Video'),
          from,
          to,
          category,
          videoFile: args.videoFile,
          transcriptFile: resolved?.ok ? resolved.path : undefined,
          dryRun: args.dryRun,
          signal: context.signal,
          prepare: async (plan, existingTranscript) => {
            output.plan([
              { id: 'names', label: 'Checking names' },
              { id: 'writeup', label: 'Writing it up' },
              { id: 'file', label: 'Filing missing content' },
            ])
            const sourceArgs = existingTranscript
              ? { text: existingTranscript }
              : args.fromSrt !== undefined
                ? { fromSrt: resolved!.ok ? resolved!.path : undefined }
                : args.fromZoomVtt !== undefined
                  ? { fromZoomVtt: resolved!.ok ? resolved!.path : undefined }
                  : { fromText: resolved!.ok ? resolved!.path : undefined }
            if (!plan.missing.includes('summary')) {
              const clean = await tasks.run('audio:transcript:clean', {
                ...sourceArgs,
                acceptAllReviews: args.acceptAllReviews,
                save: false,
                fresh: args.fresh,
              })
              if (!clean.ok || !clean.data) throw new Error(clean.message || 'Transcript cleaning failed')
              completedRun = clean.data.run
              return { cleanedText: clean.data.cleanedText }
            }
            const result = await tasks.run('audio:transcript:summary', {
              ...sourceArgs,
              template: 'audio-message',
              acceptAllReviews: args.acceptAllReviews,
              when: plan.when,
              fresh: args.fresh,
              save: false,
            })
            if (!result.ok || !result.data) throw new Error(result.message || 'Transcript processing failed')
            completedRun = result.data.run
            const data = result.data
            if (plan.action !== 'create') return data
            const enrich = {
              to: to || data.to || undefined,
              from: from || data.from || undefined,
              conversation: from || data.from || to || data.to || undefined,
              summary: summary || data.title,
              body: data.body,
            }
            const [tags, rel] = await Promise.all([
              args.noAutoTag ? undefined : autoTagMessage(enrich, VIDEO_ENRICH),
              args.noAutoRel ? undefined : autoRelMessage(enrich, VIDEO_ENRICH),
            ])
            return { ...data, tags, rel: mergeRel(data.rel, rel) }
          },
        })
        if (completedRun) await (await TranscriptRun.open(completedRun, runOptionsFor(context))).clear()
        output.log(JSON.stringify(result.plan, null, 2))
        return CommandResult.success(result)
      } catch (error) {
        return CommandResult.fail((error as Error).message)
      }
    }
    if (args.dryRun || args.videoFile || args.recordedAt)
      return CommandResult.fail('Use --url to match, preview or attach a complete video import.')

    if (args.fromText !== undefined)
      return CommandResult.fail('Use --url with --from-text to identify the video import.')

    if (fromSrt !== undefined && fromZoomVtt !== undefined) {
      return CommandResult.fail('Use only one of --from-srt or --from-zoom-vtt')
    }

    // --from-srt / --from-zoom-vtt pipeline: clean + summarize the transcript via
    // audio:transcript:summary. The 'audio-message' template is the
    // one-way-communication shape (from/to rather than a shared attendee list),
    // which is what a recorded video is.
    const fromTranscript = fromSrt ?? fromZoomVtt
    if (fromTranscript !== undefined) {
      const resolved = await this.resolveTranscriptPath(fromSrt !== undefined ? '.srt' : '.vtt', fromTranscript, output)
      if (!resolved.ok) return CommandResult.fail(resolved.message)
      transcriptPath = resolved.path
      output.log(colors.cyan(`Using transcript: ${path.basename(transcriptPath)}`))

      // The run record for the transcript: what an earlier run of it already
      // produced, picked up rather than paid for again. Keyed by the file, or
      // by a host that keyed it at upload — a filed run has moved the file
      // into the attachments, and the key still finds the record.
      const runOptions = runOptionsFor(context)
      run = await TranscriptRun.resolve(args.run, transcriptPath, runOptions)
      if (args.fresh) {
        await run.clear()
        output.log('Starting over.')
      } else {
        const resume = await run.resume()
        if (resume) {
          const escape = context.platform === CommandPlatform.Console ? ' Pass --fresh to start over.' : ''
          output.log(
            `Picking up the run from ${clockLabel(resume.started, runOptions.now())} at ${resume.step}.${escape}`,
          )
        }
      }

      // The steps ahead, in the words a person reads; the transcript pipeline
      // reports the first two by the same ids as it reaches them.
      output.plan([
        { id: 'names', label: 'Checking names' },
        { id: 'writeup', label: 'Writing it up' },
        { id: 'tags', label: 'Adding tags and links' },
        { id: 'file', label: 'Filing' },
      ])

      const summaryResult = await tasks.run('audio:transcript:summary', {
        acceptAllReviews: args.acceptAllReviews,
        ...(fromSrt !== undefined ? { fromSrt: transcriptPath } : { fromZoomVtt: transcriptPath }),
        template: 'audio-message',
        run: run.key,
        fresh: args.fresh,
        // The start the caller stated goes with it, so the write-up and its check
        // say it; a host's reading of the file's clock goes as just that.
        when: rawArgs.when !== undefined ? args.when.toString() : undefined,
        clock: args.clock,
      })
      if (!summaryResult.ok || !summaryResult.data) {
        return CommandResult.fail(`Transcript pipeline failed: ${summaryResult.message}`)
      }
      if (context.signal?.aborted) return CommandResult.fail('Cancelled')

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
      // "Phone" that make no sense for a recording. Ask instead of guessing, when
      // someone is there to answer: the terminal through clack, the page through its form.
      if (!medium && args.acceptAllReviews) medium = 'Video'
      if (!medium && context.prompt.interactive) {
        const selected = await context.prompt.select({
          message: 'Which video platform?',
          options: VIDEO_MEDIUMS.map((m) => ({ value: m, label: m })),
        })
        if (selected === null) return CommandResult.fail('Cancelled')
        medium = selected
      }

      output.log(`\nExtracted: from="${from ?? ''}", to="${to ?? ''}", summary="${summary}", when="${when}"`)
      if (rel && rel.length > 0) output.log(`  Related: ${rel.join(', ')}`)

      // Enrich from the archived-video corpus, keyed on the speaker: a
      // recording is one-way, and a colleague's weekly update files the way
      // their last one did. Auto-rel runs alongside the transcript's own
      // extraction rather than instead of it, appending graph-validated refs
      // the pipeline missed. The manual path stays as it is: a title and a
      // placeholder body give the classifiers nothing to read.
      output.stage('tags', 'Adding tags and links')
      const enrichInput = { to, from, conversation: from ?? to, summary, body: data.body }
      const [autoTags, autoRel] = await Promise.all([
        args.noAutoTag ? undefined : autoTagMessage(enrichInput, VIDEO_ENRICH),
        args.noAutoRel ? undefined : autoRelMessage(enrichInput, VIDEO_ENRICH),
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

    const whenDate = when.plainDate
    const mediumValue = medium || 'Video'

    const stem = videoFileStem({ medium: mediumValue, from, to, summary })
    const fileName = `${actionKindRel('video')}/${stem}.md`

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
    // On a transcript's path the AI summary + transcript replace the empty template.
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
    if (transcriptPath) {
      output.stage('file', 'Filing')
      const sourcePath = transcriptPath
      const attachDir = path.join(config.DIR_ATTACHMENTS as string, dayAttachmentsDir(whenDate))
      const attachmentFile = videoAttachmentName(whenDate.toString(), stem, path.extname(sourcePath))
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
      ...(tags ? { tags } : {}),
      body: finalBody,
    })

    // toMarkdown() has no trailing newline; video files have always ended with one.
    const data = video.toMarkdown() + '\n'

    const filePath = await ddfw.write(fileName, data)

    const dayItemParts = [when.time, '>']
    if (entryWho) {
      dayItemParts.push(entryWho)
    }
    dayItemParts.push(mediumValue, '->', `[${summary || ''}](<${filePath}>)`)
    const dayItem = dayItemParts.join(' ')
    await writeDayItems(whenDate, category, dayItem)

    const fullPath = path.join(ddfw.fullDir, filePath)

    // The terminal opens the file to read; any other host has its own way to show it.
    if (context.platform === CommandPlatform.Console) {
      await openEditor([{ file: fullPath, line: data.split('\n').length }])
    }

    // The run is complete: nothing of it outlives the video on disk.
    if (run) await run.clear()

    output.log(`\n  Successfully created ${filePath}.\n`)

    return CommandResult.success({ filePath: fullPath })
  }

  /**
   * Resolve --from-srt or --from-zoom-vtt to a file. A valueless flag arrives as
   * the string "true" at runtime, which means "search the Desktop" for that
   * flag's own extension.
   *
   * Resolved here rather than delegated to the pipeline's own lookup so a wrong
   * path fails before the pipeline starts, and so the attachment import below
   * gets an absolute path. An .srt must be named one; a Zoom transcript is taken
   * under any name, as meeting:new takes it — the import hands on a .txt it read
   * as VTT.
   */
  private async resolveTranscriptPath(
    ext: '.srt' | '.vtt' | '.txt',
    value: string,
    output: OutputHandler,
  ): Promise<{ ok: true; path: string } | { ok: false; message: string }> {
    const flag = ext === '.srt' ? '--from-srt' : ext === '.txt' ? '--from-text' : '--from-zoom-vtt'
    if (typeof value === 'string' && value !== 'true') {
      if (ext === '.srt' && path.extname(value).toLowerCase() !== '.srt') {
        return { ok: false, message: `--from-srt requires an .srt file, got: ${path.basename(value)}` }
      }
      return { ok: true, path: path.resolve(value) }
    }

    const found = await desktopFilesByExt([ext])
    if (found.length === 0) {
      return {
        ok: false,
        message: `No ${ext} file found on Desktop. Specify a path: ${flag} /path/to/transcript${ext}`,
      }
    }
    if (found.length > 1) {
      output.log(colors.gray(`${found.length} ${ext} files on Desktop, using newest`))
    }
    return { ok: true, path: found[0].path }
  }
}
