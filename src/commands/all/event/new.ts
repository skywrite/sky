import * as path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import openEditor from 'open-editor'
import { clearTranscriptRun } from '#commands/all/audio/transcript/lib/transcriptRun.ts'
import { Arg, categoryComplete, Command, CommandPlatform, CommandResult, Flag, whenNBTime } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { DayDirFileWriter, writeDayItems } from '#lib/nbfs/mod.ts'
import slugify from '#lib/string/slugify.ts'
import EventDocument from '#shared/models/Event/mod.ts'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'

const params = {
  what: Arg.string('Event summary/description (optional with --from-audio)', { optional: true }),
  fromAudio: Flag.string('Path to audio file, or omit path to search Desktop', {
    short: 'a',
    optional: true,
  }),
  when: whenNBTime(),
  category: categoryComplete(),
  fresh: Flag.bool('Start over: forget what an earlier run of the recording already produced', { default: false }),
}

type Params = InferParams<typeof params>
type Result = { file: string }

export default class EventNewTask extends Command {
  static override description: CommandDescription = {
    name: 'event:new',
    description: 'Create new Event.',
    params,
  }

  async run({ args, context, tasks, rawArgs }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context
    let { what, when, category, fromAudio } = args
    let body: string | undefined
    let rel: string[] | undefined
    let who: string | string[] | undefined
    /** The pipeline's run record, forgotten once the event is filed */
    let runKey: string | null = null

    // Handle --from-audio pipeline via audio:transcript:summary
    const useAudioPipeline = fromAudio !== undefined

    if (useAudioPipeline) {
      const summaryResult = await tasks.run('audio:transcript:summary', {
        fromAudio,
        fresh: args.fresh,
        when: rawArgs.when !== undefined ? args.when.toString() : undefined,
      })
      if (!summaryResult.ok || !summaryResult.data) {
        return CommandResult.fail(`Audio pipeline failed: ${summaryResult.message}`)
      }

      const data = summaryResult.data
      runKey = data.run

      what = data.title
      body = data.body
      rel = data.rel.length > 0 ? data.rel : undefined
      who = data.who.length > 0 ? data.who : undefined

      if (data.time) {
        when = new PlainDateTime(data.time)
      }

      output.log(`\nExtracted: what="${what}", who="${who ?? ''}", when="${when}"`)
      if (rel && rel.length > 0) {
        output.log(`  Related: ${rel.join(', ')}`)
      }
      output.log('')
    }

    // Validate required fields for non-audio path
    if (!what) {
      return CommandResult.fail('Missing required argument: what (or use --from-audio)')
    }

    const whenDate = when.plainDate
    const entryWhen = when.time
    const whatSlug = slugify(what, { suggestedLength: 60, preserveCase: true })

    const eventFileName = `actions/events/${whatSlug}.md`

    const ddfw = new DayDirFileWriter(whenDate)
    const whoVal = Array.isArray(who) && who.length > 4 ? who : Array.isArray(who) ? who.join(', ') : who
    const relVal: string | string[] | undefined = rel && rel.length > 4 ? rel : rel ? rel.join(', ') : undefined
    const event = EventDocument.create({ what, when, who: whoVal, rel: relVal, body })

    const data = event.toMarkdown()

    let file: string
    try {
      file = await ddfw.write(eventFileName, data)
    } catch (err) {
      return CommandResult.error(err as Error, 'Failed to write event file')
    }

    try {
      const dayItem = `${entryWhen} > Event -> [${what}](${file})`
      await writeDayItems(whenDate, category, dayItem)
    } catch (err) {
      return CommandResult.error(err as Error, 'Failed to write day item')
    }

    if (context.platform === CommandPlatform.Console) {
      openEditor([{ file: path.join(ddfw.fullDir, file), line: data.split('\n').length }])
    }
    await delay(500)

    if (runKey) await clearTranscriptRun(runKey)

    output.log(`\n  Successfully created event ${file}.\n`)

    return CommandResult.success({ file })
  }
}
