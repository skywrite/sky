import { copyFile, mkdir, rename } from 'node:fs/promises'
import * as path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import * as p from '@clack/prompts'
import openEditor from 'open-editor'
import colors from 'picocolors'
import { Arg, categoryComplete, Command, CommandResult, Flag, whenNBTime } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { DayDirFileWriter, dayFileExists, meetingFileName, writeDayItems } from '#lib/nbfs/mod.ts'
import { parseActionItemsSection, type TranscriptActionItem } from '#lib/notebook/actionItems.ts'
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
import { isTerminal } from '#shared/sys/mod.ts'
import { PlainDate, PlainDateTime, When } from '#universal/dates/nbdt/mod.ts'

const params = {
  who: Arg.string('Person or group (optional with --from-voice-memo/--from-zoom-vtt)', { optional: true }),
  fromVoiceMemo: Flag.string('Path to a voice memo summarizing the meeting, or omit path to search Desktop', {
    short: 'a',
    optional: true,
  }),
  fromZoomVtt: Flag.string('Path to transcript file, or omit to use the newest .vtt on the Desktop', {
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
  noActions: Flag.bool('Skip action-item acceptance into the day/schedule/next lists', { default: false }),
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

  async run({ args, context, tasks }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output, config } = context
    let { when, medium, who, summary, category, fromVoiceMemo, fromZoomVtt, duration } = args
    let body: string | undefined
    let rel: string[] | undefined
    let tags: string | undefined
    let transcriptSourcePath: string | null = null
    let actionItems: TranscriptActionItem[] = []

    if (fromVoiceMemo !== undefined && fromZoomVtt !== undefined) {
      return CommandResult.fail('Use either --from-voice-memo or --from-zoom-vtt, not both')
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

    // Handle --from-voice-memo / --from-zoom-vtt pipeline via audio:transcript:summary
    const usePipeline = fromVoiceMemo !== undefined || fromZoomVtt !== undefined

    if (usePipeline) {
      // Delegate to audio:transcript:summary which handles:
      // (audio: transcribe →) clean → summarize with user corrections
      const summaryResult = await tasks.run(
        'audio:transcript:summary',
        fromVoiceMemo !== undefined ? { fromAudio: fromVoiceMemo } : { fromZoomVtt },
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

      // The extract call is the primary source of action items — it resolves
      // relative due phrases ("Friday") to dates. The deterministic section
      // parse is the fallback when it failed or omitted them; those items
      // carry no dates and so route to the Next list.
      actionItems = data.actionItems.length > 0 ? data.actionItems : parseActionItemsSection(data.body)

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

      // Only --from-zoom-vtt hands us a file worth keeping: on the --from-voice-memo
      // path the .vtt is a generated artifact, and the recording it came from is
      // the file that matters.
      if (fromZoomVtt !== undefined) {
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
      return CommandResult.fail('Missing required argument: who (or use --from-voice-memo/--from-zoom-vtt)')
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

    // Formal acceptance of the meeting's action items: nothing routes anywhere
    // without an explicit confirm. Runs after the meeting file and day item are
    // on disk so a cancel or crash here can't lose them, and before openEditor
    // so the prompt isn't buried by the editor stealing focus. Professional
    // meetings only — the category default.
    if (actionItems.length > 0 && !args.noActions && category.startsWith('Professional') && isTerminal()) {
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

    openEditor([{ file: path.join(ddfw.fullDir, file), line: data.split('\n').length }])
    await delay(500)

    output.log(`\n  Successfully created meeting ${file}.\n`)

    return CommandResult.success({ file })
  }

  // One selector over every extracted item, the speaker's own preselected:
  // a misattributed owner stays one keystroke from rescue instead of silently
  // lost. Routes are decided up front so each option's hint can say where
  // acceptance sends it.
  private async acceptActionItems(
    items: TranscriptActionItem[],
    context: CommandArgs<Params>['context'],
    tasks: CommandArgs<Params>['tasks'],
  ): Promise<void> {
    const { output } = context
    const today = String(context.notebookNow.date)

    const routes = await Promise.all(items.map((item) => planActionItemRoute(item, today)))

    const indexes = items.map((_, i) => i)
    const selected = await p.multiselect({
      message: 'Accept action items (space toggles, enter confirms)',
      options: indexes.map((i) => ({
        value: i,
        label: items[i].text,
        hint: [items[i].mine ? 'me' : null, `→ ${routes[i].destination}`].filter(Boolean).join(' · '),
      })),
      initialValues: indexes.filter((i) => items[i].mine),
      required: false,
    })

    if (p.isCancel(selected)) {
      output.log('  Action items skipped.')
      return
    }

    // Meeting order, not toggle order
    const accepted = [...selected].sort((a, b) => a - b)
    if (accepted.length === 0) {
      output.log('  No action items accepted.')
      return
    }

    let routed = 0
    for (const i of accepted) {
      try {
        await executeActionItemRoute(routes[i], tasks)
        routed++
        output.log(`  ✓ ${items[i].text} → ${routes[i].destination}`)
      } catch (err) {
        output.error(`  ✗ ${items[i].text} — ${(err as Error).message}`)
      }
    }
    const declined = items.length - accepted.length
    output.log(`  Routed ${routed} of ${accepted.length} accepted action items (${declined} declined).`)
  }
}

// Where an accepted action item lands. Decided before the selector renders so
// the hint can announce it, executed only after the user confirms.
type ActionItemRoute =
  | { kind: 'next'; task: string; destination: string }
  | { kind: 'commitments'; task: string; when: PlainDate; destination: string }
  | { kind: 'todo'; task: string; when: PlainDate; destination: string }

async function planActionItemRoute(item: TranscriptActionItem, today: string): Promise<ActionItemRoute> {
  // A past date can't be scheduled — an overdue commitment is still next work.
  const date = item.date !== null && item.date >= today ? item.date : null
  if (date === null) return { kind: 'next', task: item.text, destination: 'next-professional' }

  // The HH:MM prefix is the day-item convention, and how day:schedule:update
  // recognizes a Commitment when it drains the schedule file on the morning.
  // Only a timed item is a Commitment; a dated one without a time is a Todo
  // on its day, mirroring that drain's split.
  const task = item.time !== null ? `${item.time} > ${item.text}` : item.text
  const when = new PlainDate(date)

  if (await dayFileExists(when)) {
    if (item.time !== null) return { kind: 'commitments', task, when, destination: `${date} Commitments` }
    return { kind: 'todo', task, when, destination: `${date} Todos` }
  }
  return { kind: 'todo', task, when, destination: `schedule-professional ${date}` }
}

async function executeActionItemRoute(route: ActionItemRoute, tasks: CommandArgs<Params>['tasks']): Promise<void> {
  if (route.kind === 'commitments') {
    await writeDayItems(route.when, 'Professional Commitments', route.task)
    return
  }
  // day:todo:add itself forks on whether the day file exists yet: into its
  // Todos list when it does, into the schedule file's date entry when not.
  const result =
    route.kind === 'next'
      ? await tasks.run('next:add', { task: route.task })
      : await tasks.run('day:todo:add', { task: route.task, when: route.when })
  if (!result.ok) {
    throw new Error(result.message ?? `${route.kind === 'next' ? 'next:add' : 'day:todo:add'} failed`)
  }
}
