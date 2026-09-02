import { copyFile, mkdir, rename } from 'node:fs/promises'
import * as path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import openEditor from 'open-editor'
import colors from 'picocolors'
import { clearTranscriptRun } from '#commands/all/audio/transcript/lib/transcriptRun.ts'
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
import slugify from '#lib/string/slugify.ts'
import dayAttachmentsDir from '#shared/nbfs/dayAttachmentsDir.ts'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import { notesFromImage } from './lib/fromImage.ts'

const params = {
  summary: ArgOrFlag.string('Summary / Header of Notes', { short: 's', optional: true }),
  fromAudio: Flag.string('Path to audio file, or omit path to search Desktop', {
    short: 'a',
    optional: true,
  }),
  fromImage: Flag.string('Path(s) to image(s), comma-separated, or omit path to search Desktop', {
    short: 'i',
    optional: true,
  }),
  aiContext: Flag.string('Additional context for AI image extraction', { optional: true }),
  when: whenNBTime(),
  category: categoryComplete(),
  noAutoTag: Flag.bool('Skip automatic tagging from the archived-notes tag corpus', { default: false }),
  noAutoRel: Flag.bool('Skip automatic rel suggestion from the entity graph', { default: false }),
  fresh: Flag.bool('Start over: forget what an earlier run of the recording already produced', { default: false }),
}

// `kind` is the noun the enrichment prompts use for what they are labeling.
const NOTES_ENRICH: { mediums: string[]; kind: string } = { mediums: ['note'], kind: 'note' }

type Params = InferParams<typeof params>
type Result = { filePath: string }

export default class NotesNewTask extends Command {
  static override description: CommandDescription = {
    name: 'notes:new',
    description: 'Create new note.',
    params,
  }

  async run({ args, context, tasks, rawArgs }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output, config } = context
    let { summary, when, category, fromAudio, fromImage, aiContext } = args
    let body = ''
    let rel: string[] | undefined
    let attachmentFiles: string[] = []
    /** The pipeline's run record, forgotten once the note is filed */
    let runKey: string | null = null

    const useAudioPipeline = fromAudio !== undefined
    const useImagePipeline = fromImage !== undefined

    // Both would run, and the images would then overwrite the summary, time and
    // body the recording had just produced.
    if (useAudioPipeline && useImagePipeline) {
      return CommandResult.fail('Use --from-audio or --from-image, not both.')
    }

    if (useAudioPipeline) {
      const summaryResult = await tasks.run('audio:transcript:summary', {
        fromAudio,
        fresh: args.fresh,
        when: rawArgs.when !== undefined ? args.when.toString() : undefined,
        summaryPrompt: new URL('./prompts/audio-summary.prompt.md', import.meta.url).pathname,
        extractPrompt: new URL('./prompts/audio-extract.prompt.md', import.meta.url).pathname,
      })
      if (!summaryResult.ok || !summaryResult.data) {
        return CommandResult.fail(`Audio pipeline failed: ${summaryResult.message}`)
      }

      const data = summaryResult.data
      runKey = data.run
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

        attachmentFiles.push(newFileName)
        output.log(colors.gray(`Moved audio file to ${attachDir}\n`))
      }
    }

    if (useImagePipeline) {
      const imageResult = await notesFromImage({
        fromImage,
        summary,
        when,
        // rawArgs is the parse before defaults are applied, so a `when` key
        // there means the user typed --when and meant it.
        whenExplicit: rawArgs.when !== undefined,
        aiContext,
        context,
      })
      // Unprefixed: unlike the audio task, these messages are written here and
      // already say what went wrong ("Cancelled", "File not found: ...").
      if (!imageResult.ok || !imageResult.data) {
        return CommandResult.fail(imageResult.message ?? 'Could not read the images')
      }

      const note = imageResult.data
      summary = note.summary
      when = note.when
      if (note.rel.length > 0) rel = note.rel
      body = note.body
      attachmentFiles = note.attachmentFiles
    }

    if (!summary) {
      return CommandResult.fail('Missing required argument: summary (or use --from-audio / --from-image)')
    }

    // Enrich from the archived-notes corpus — pipeline paths only: a manual
    // note is created empty and written in the editor afterwards, so there is
    // nothing to classify at creation time. Auto-rel runs alongside the
    // pipeline's own extraction rather than instead of it, appending
    // graph-validated refs the transcript or image pass missed.
    let tags: string | undefined
    if (useAudioPipeline || useImagePipeline) {
      const enrichInput = { summary, body }
      const [autoTags, autoRel] = await Promise.all([
        args.noAutoTag ? undefined : autoTagMessage(enrichInput, NOTES_ENRICH),
        args.noAutoRel ? undefined : autoRelMessage(enrichInput, NOTES_ENRICH),
      ])
      tags = autoTags
      if (autoTags) output.log(`  Auto-tags: ${autoTags}`)
      const merged = mergeRel(rel, autoRel)
      if (autoRel && merged && merged.length > (rel?.length ?? 0)) {
        output.log(`  Auto-rel: ${merged.slice(rel?.length ?? 0).join(', ')}`)
      }
      rel = merged
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

    yamlLines.push(tags ? `tags: ${tags}` : 'tags:')

    if (attachmentFiles.length > 0) {
      yamlLines.push('attachments:')
      for (const file of attachmentFiles) yamlLines.push(`  - file: ${file}`)
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

    if (context.platform === CommandPlatform.Console) {
      openEditor([{ file: path.join(ddfw.fullDir, filePath), line: data.split('\n').length }])
    }
    await delay(500)

    if (runKey) await clearTranscriptRun(runKey)

    output.log(`\n  Successfully created ${filePath}.\n`)

    return CommandResult.success({ filePath })
  }
}
