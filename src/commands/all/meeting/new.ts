import { copyFile, mkdir, rename } from 'node:fs/promises'
import * as path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import openEditor from 'open-editor'
import colors from 'picocolors'
import {
  type Checkpoint,
  clockLabel,
  runOptionsFor,
  TranscriptRun,
} from '#commands/all/audio/transcript/lib/transcriptRun.ts'
import { Arg, categoryComplete, Command, CommandPlatform, CommandResult, Flag, whenNBTime } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { DayDirFileWriter, meetingFileName, writeDayItems } from '#lib/nbfs/mod.ts'
import { normalizeActionItems, parseActionItemsSection, type TranscriptActionItem } from '#lib/notebook/actionItems.ts'
import { autoRelMessage, mergeRel } from '#lib/notebook/enrich/autoRel.ts'
import { autoTagMessage } from '#lib/notebook/enrich/autoTag.ts'
import { distillPersonFactsFromText } from '#lib/notebook/enrich/distillPersonFacts.ts'
import { serviceDocumentIO } from '#lib/service/documents.ts'
import slugify from '#lib/string/slugify.ts'
import { userSpeakerLabel } from '#shared/models/Chat/document/mod.ts'
import type { Attachment } from '#shared/models/Markdown/Document/attachment.ts'
import MeetingDocument from '#shared/models/Meeting/mod.ts'
import { applyPersonFacts, formatPersonOpLine } from '#shared/models/Person/write.ts'
import dayAttachmentsDir from '#shared/nbfs/dayAttachmentsDir.ts'
import { PlainDate, PlainDateTime, When } from '#universal/dates/nbdt/mod.ts'
import { placeLabel, type PlaceWhen } from '#universal/dates/whenLabel/mod.ts'
import {
  countWaiting,
  executeActionItemRoute,
  lastCreatedDay,
  planActionItemRoute,
  proposedWhen,
} from './lib/actionItemRoutes.ts'

const params = {
  who: Arg.string('Person or group (optional with --from-voice-memo/--from-zoom-vtt/--from-text)', {
    optional: true,
  }),
  fromVoiceMemo: Flag.string('Path to a voice memo summarizing the meeting, or omit path to search Desktop', {
    short: 'a',
    optional: true,
  }),
  fromZoomVtt: Flag.string('Path to transcript file, or omit to use the newest .vtt on the Desktop', {
    short: 't',
    optional: true,
  }),
  fromText: Flag.string('Path to a .txt transcript of speaker lines, or omit to use the newest .txt on the Desktop', {
    optional: true,
  }),
  when: whenNBTime(),
  duration: Flag.string('Meeting length e.g. 45m, 2h', { short: 'd', optional: true }),
  category: categoryComplete(),
  medium: Flag.string('Meeting medium e.g. Zoom, Phone, etc', { short: 'm', default: () => 'Zoom' }),
  summary: Flag.string('Meeting summary', { short: 's', default: () => '' }),
  noAutoTag: Flag.bool('Skip automatic tagging from the archived-meeting tag corpus', { default: false }),
  noAutoRel: Flag.bool('Skip automatic rel suggestion from the entity graph', { default: false }),
  noActions: Flag.bool('Skip action-item acceptance into the day/schedule/next lists', { default: false }),
  fresh: Flag.bool('Start over: forget what an earlier run of the file already produced', { default: false }),
  run: Flag.string('Run record key, passed by a host that keyed the file itself', { optional: true, hidden: true }),
  clock: Flag.string(
    "The start the file's clock gives, in notebook time, passed by a host that read the file; sky's reading, not the caller's, so a time the transcript states wins over it",
    { optional: true, hidden: true },
  ),
}

type Params = InferParams<typeof params>
type Result = { file: string }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'meeting:new': { params: Params; result: Result }
  }
}

export default class MeetingNewTask extends Command {
  static override description: CommandDescription = {
    name: 'meeting:new',
    description: 'Create new Meeting.',
    params,
  }

  async run({ args, context, tasks, rawArgs }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output, config } = context
    let { when, medium, who, summary, category, fromVoiceMemo, fromZoomVtt, fromText, duration } = args
    let body: string | undefined
    let rel: string[] | undefined
    let tags: string | undefined
    /** Files the notebook takes ownership of: the transcript, or the recording and its transcript */
    let importFiles: string[] = []
    let actionItems: TranscriptActionItem[] = []
    let anchors: string[] | undefined
    // A when the caller stated outright — typed, or changed by hand in a
    // dialog — is theirs, and goes down to the pipeline as such; the default
    // gives way to whatever time the pipeline settles on.
    const whenStated = rawArgs.when !== undefined

    const sources = [fromVoiceMemo, fromZoomVtt, fromText].filter((flag) => flag !== undefined)
    if (sources.length > 1) {
      return CommandResult.fail('Use only one of --from-voice-memo, --from-zoom-vtt or --from-text')
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

    // Handle --from-voice-memo / --from-zoom-vtt / --from-text pipeline via audio:transcript:summary
    const usePipeline = sources.length === 1
    const willRouteActions = !args.noActions && category.startsWith('Professional')

    // The run record for the source file: what an earlier run of it already
    // produced, picked up rather than paid for again. Known up front when the
    // file was named, or when a host keyed it — a filed run has moved the file
    // into the attachments, and the key still finds the record. A file found
    // on the Desktop is keyed by the pipeline.
    const runOptions = runOptionsFor(context)
    const sourcePath = sources.find((flag): flag is string => typeof flag === 'string' && flag !== 'true')
    let run = sourcePath
      ? await TranscriptRun.resolve(args.run, sourcePath, runOptions)
      : args.run
        ? await TranscriptRun.open(args.run, runOptions)
        : null

    if (usePipeline) {
      if (run && args.fresh) {
        await run.clear()
        output.log('Starting over.')
      } else if (run) {
        const resume = await run.resume()
        if (resume) {
          const escape = context.platform === CommandPlatform.Console ? ' Pass --fresh to start over.' : ''
          output.log(
            `Picking up the run from ${clockLabel(resume.started, runOptions.now())} at ${resume.step}.${escape}`,
          )
        }
        // Filed already, by a run that stopped after: no second meeting.
        const filed = await run.get('filed')
        if (filed) return this.finishFiled(run, filed, context, tasks)
      }

      // The steps ahead, in the words a person reads; the transcript pipeline
      // reports the first three by the same ids as it reaches them.
      output.plan([
        ...(fromVoiceMemo !== undefined ? [{ id: 'transcribe', label: 'Transcribing' }] : []),
        { id: 'names', label: 'Checking names' },
        { id: 'writeup', label: 'Writing it up' },
        { id: 'file', label: 'Filing' },
        ...(willRouteActions ? [{ id: 'actions', label: 'Action items' }] : []),
      ])

      // Delegate to audio:transcript:summary which handles:
      // (audio: transcribe →) clean → summarize with user corrections
      const summaryResult = await tasks.run('audio:transcript:summary', {
        ...(fromVoiceMemo !== undefined
          ? { fromAudio: fromVoiceMemo }
          : fromText !== undefined
            ? { fromText }
            : { fromZoomVtt }),
        run: run?.key,
        fresh: args.fresh,
        // The start the caller stated goes with it, so the write-up and its check
        // say it; a host's reading of the file's clock goes as just that.
        when: whenStated ? when.toString() : undefined,
        clock: args.clock,
      })
      if (!summaryResult.ok || !summaryResult.data) {
        return CommandResult.fail(`Transcript pipeline failed: ${summaryResult.message}`)
      }
      if (context.signal?.aborted) return CommandResult.fail('Cancelled')

      const data = summaryResult.data

      // A file found on the Desktop was keyed by the pipeline; the filed check
      // it could not have up front happens here, before anything is written.
      if (!run && data.run) {
        run = await TranscriptRun.open(data.run, runOptions)
        const filed = await run.get('filed')
        if (filed) return this.finishFiled(run, filed, context, tasks)
      }

      // Extract meeting data from results
      who = data.who.length > 0 ? data.who.join(', ') : 'Unknown'
      summary = data.title
      body = data.body
      rel = data.rel.length > 0 ? data.rel : undefined

      // The pipeline's people lists, as confirmed at its corrections prompt,
      // anchor the profile distiller below: a full name pins its profile, a
      // bare name pins none. Auto-rel additions stay out — they resolve by
      // the score prior anchoring sets aside.
      anchors = [...data.who, ...data.rel]

      // The extract call is the primary source of action items — it resolves
      // relative due phrases ("Friday") to dates. The deterministic section
      // parse is the fallback when it failed or omitted them; those items
      // carry no dates and so route to the Next list.
      actionItems = data.actionItems.length > 0 ? data.actionItems : parseActionItemsSection(data.body)

      // The pipeline's time is the last word on it: a stated start folded in,
      // the words read against the clock, and whatever the check settled on.
      if (data.time) when = new PlainDateTime(data.time)

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

      // --from-zoom-vtt and --from-text hand us a file worth keeping. On the
      // --from-voice-memo path the recording is the file that matters, and the
      // transcript written beside it comes along.
      if (fromZoomVtt !== undefined || fromText !== undefined) {
        importFiles = data.transcriptFilePath ? [data.transcriptFilePath] : []
      } else if (fromVoiceMemo !== undefined) {
        importFiles = [data.audioFilePath, data.transcriptFilePath].filter((f): f is string => Boolean(f))
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
      return CommandResult.fail('Missing required argument: who (or use --from-voice-memo/--from-zoom-vtt/--from-text)')
    }

    if (usePipeline) output.stage('file', 'Filing')

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

    // Move the source files into the day's attachments so the notebook owns them,
    // then point the meeting file at them. A failure here must not lose the summary
    // the AI pipeline just produced, so it degrades to a warning.
    let attachments: Attachment[] | undefined
    for (const sourcePath of importFiles) {
      const attachDir = path.join(config.DIR_ATTACHMENTS as string, dayAttachmentsDir(whenDate))
      const attachmentFile = `${whenDate}_${fileSlug}${path.extname(sourcePath)}`
      const destPath = path.join(attachDir, attachmentFile)

      try {
        await mkdir(attachDir, { recursive: true })
        await rename(sourcePath, destPath).catch(async () => {
          await copyFile(sourcePath, destPath)
        })
        attachments = [...(attachments ?? []), { file: attachmentFile }]
        output.log(`  Imported ${path.basename(sourcePath)} to ${destPath}`)
      } catch (err) {
        output.error(`Failed to import ${sourcePath}: ${(err as Error).message}`)
      }
    }
    if (importFiles.length > 0) output.log('')

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

    // From here the meeting exists; a rerun after a stop below must not file it again.
    if (run) {
      await run.put('filed', {
        file: path.join(ddfw.fullDir, file),
        actionItems,
        routeActions: willRouteActions,
      })
    }

    // Formal acceptance of the meeting's action items: nothing routes anywhere
    // without an explicit confirm. Runs after the meeting file and day item are
    // on disk so a cancel or crash here can't lose them, and before openEditor
    // so the prompt isn't buried by the editor stealing focus. Professional
    // meetings only — the category default.
    if (actionItems.length > 0 && willRouteActions && context.prompt.interactive && !context.signal?.aborted) {
      output.stage('actions', 'Action items', `${actionItems.length} to accept`)
      try {
        await this.acceptActionItems(actionItems, context, tasks)
      } catch (err) {
        output.error(`Action-item routing failed: ${(err as Error).message}`)
      }
    }

    // What the meeting taught the CRM (people/ profiles) — the same
    // distiller every chat save runs, against the summarized body (the
    // manual path has no content worth distilling). Autonomous: the
    // never-delete discipline lives in models/Person/write.ts, so no TTY or
    // category gate. Facts anchor to the meeting's day; updated: stamps the
    // day the edit actually happened. The meeting file is already on disk,
    // so a failure degrades to a warning.
    if (body) {
      try {
        const distilled = await distillPersonFactsFromText({
          text: [who, summary, body].filter(Boolean).join('\n'),
          today: String(whenDate),
          userLabel: userSpeakerLabel(),
          kind: 'meeting summary',
          anchors,
        })
        if (distilled && (distilled.facts.length > 0 || distilled.unlisted.length > 0)) {
          const outcomes = await applyPersonFacts({
            facts: distilled.facts,
            unlisted: distilled.unlisted,
            subjects: distilled.subjects,
            today: String(context.notebookNow.date),
            io: serviceDocumentIO(),
          })
          if (outcomes.length > 0) output.log('')
          for (const o of outcomes) {
            const line = formatPersonOpLine(o)
            output.log(line.dim ? colors.dim(line.text) : line.text)
          }
        }
      } catch (err) {
        output.error(`Person-profile curation failed: ${(err as Error).message}`)
      }
    }

    // The terminal opens the file to read; any other host has its own way to show it.
    if (context.platform === CommandPlatform.Console) {
      openEditor([{ file: path.join(ddfw.fullDir, file), line: data.split('\n').length }])
      await delay(500)
    }

    // The run is complete: nothing of it outlives the meeting on disk.
    if (run) await run.clear()

    output.log(`\n  Successfully created meeting ${file}.\n`)

    return CommandResult.success({ file })
  }

  // A run that filed the meeting and stopped after — in the action items, in
  // the profile curation, in a restart — picks up with what was left: the
  // action items still to accept. The meeting itself is not touched.
  private async finishFiled(
    run: TranscriptRun,
    filed: Checkpoint<'filed'>,
    context: CommandArgs<Params>['context'],
    tasks: CommandArgs<Params>['tasks'],
  ): Promise<CommandResult<Result>> {
    const { output } = context
    const { file, routeActions } = filed.data
    const actionItems = normalizeActionItems(filed.data.actionItems)
    output.log(`Already filed at ${clockLabel(filed.at, runOptionsFor(context).now())}: ${path.basename(file)}`)

    if (actionItems.length > 0 && routeActions && context.prompt.interactive && !context.signal?.aborted) {
      output.plan([{ id: 'actions', label: 'Action items' }])
      output.stage('actions', 'Action items', `${actionItems.length} to accept`)
      try {
        await this.acceptActionItems(actionItems, context, tasks)
      } catch (err) {
        output.error(`Action-item routing failed: ${(err as Error).message}`)
      }
    }

    if (context.platform === CommandPlatform.Console) {
      openEditor([{ file, line: 1 }])
      await delay(500)
    }

    await run.clear()
    output.log(`\n  Meeting ${path.basename(file)} is filed.\n`)
    // Absolute, where the fresh path returns the day-relative name: the day
    // it was filed under is the record's, not this run's.
    return CommandResult.success({ file })
  }

  // One question over every extracted item, the speaker's own preselected:
  // a misattributed owner stays one keystroke from rescue instead of silently
  // lost. Each item arrives with a proposed when — the day and time its words
  // named, or tomorrow when they named none; the Next list is never proposed,
  // it is where items go to be forgotten — and the answer says where each
  // accepted one goes. Routes are decided from the answer, so the ledger can
  // say it.
  private async acceptActionItems(
    items: TranscriptActionItem[],
    context: CommandArgs<Params>['context'],
    tasks: CommandArgs<Params>['tasks'],
  ): Promise<void> {
    const { config, output } = context
    const today = new PlainDate(context.notebookNow.date)
    const fallback: PlaceWhen = { date: today.addDays(1).ymd, time: null }
    const proposed = items.map((item) => proposedWhen(item, today.ymd, fallback))
    const indexes = items.map((_, i) => i)

    const answer = await context.prompt.place({
      message: 'Accept action items (space toggles, enter confirms)',
      items: indexes.map((i) => ({
        value: String(i),
        label: items[i].text,
        hint: [items[i].mine ? 'me' : null, `→ ${placeLabel(proposed[i], today.ymd)}`].filter(Boolean).join(' · '),
        mine: items[i].mine,
        when: proposed[i],
      })),
      initial: indexes.filter((i) => items[i].mine).map(String),
      today: today.ymd,
      createdThrough: await lastCreatedDay(today),
      fallback,
      waiting: await countWaiting(<string>config.FILE_NEXT_PROFESSIONAL),
    })

    if (answer === null) {
      output.log('  Action items skipped.')
      return
    }

    // Meeting order, not toggle order
    const accepted = answer
      .map((a) => ({ index: Number(a.value), when: a.when }))
      .filter((a) => Number.isInteger(a.index) && a.index >= 0 && a.index < items.length)
      .sort((a, b) => a.index - b.index)
    if (accepted.length === 0) {
      output.log('  No action items accepted.')
      return
    }

    let routed = 0
    for (const [n, a] of accepted.entries()) {
      const item = items[a.index]
      const route = await planActionItemRoute({ text: item.text, when: a.when }, today.ymd)
      try {
        await executeActionItemRoute(route, tasks)
        routed++
        output.log(`  ✓ ${item.text} → ${route.destination}`)
      } catch (err) {
        output.error(`  ✗ ${item.text} — ${(err as Error).message}`)
      }
      output.tick(n + 1, accepted.length, 'action items')
    }
    const declined = items.length - accepted.length
    output.log(`  Routed ${routed} of ${accepted.length} accepted action items (${declined} declined).`)
  }
}
