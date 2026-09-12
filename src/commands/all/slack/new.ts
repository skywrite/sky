import * as path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import openEditor from 'open-editor'
import { validateAnyArgFlagExists } from '#commands/cli/mod.ts'
import { ArgOrFlag, category, Command, CommandResult, Flag, whenNBTime } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { DIR_TIME } from '#config'
import { DayDirFileWriter, messageFileName } from '#lib/nbfs/mod.ts'
import { autoRelMessage } from '#lib/notebook/enrich/autoRel.ts'
import { autoTagMessage } from '#lib/notebook/enrich/autoTag.ts'
import slugify from '#lib/string/slugify.ts'
import { readTextFile } from '#shared/fs/mod.ts'
import DayDocument from '#shared/models/Day/mod.ts'
import MessageDocument from '#shared/models/Message/mod.ts'
import dayFile from '#shared/nbfs/dayFile.ts'
import { fetchNowSync, readDay, writeDay } from '#shared/nbfs/mod.ts'
import { PlainDate, PlainDateTime, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import currentTimezoneIANA from '#universal/dates/timezones/currentTimezoneIANA.ts'
import { captureMessages, type SlackCaptureMessage } from './lib/captureMessages.ts'
import type { SlackFileRef } from './lib/copyToAttachments.ts'
import { SLACK_ENRICH } from './lib/enrich.ts'
import resolveRecipient from './lib/resolveRecipient.ts'
import { saveSlackCaptureUpdate } from './lib/saveCapture.ts'
import { summarizeSlackMessage } from './lib/summarize.ts'
import { clearSavedVoiceTranscripts, prepareSlackVoiceTranscripts } from './lib/transcribeVoiceMemo.ts'
import { updateSlackCapture } from './lib/updateCapture.ts'

const params = {
  to: ArgOrFlag.string('Channel or person', { short: 't' }),
  from: Flag.string('Who the Slack was from', { short: 'f' }),
  summary: Flag.string('Summary of message', { short: 's' }),
  when: whenNBTime(),
  category: category(),
  fromLink: Flag.string('Create from a Slack message link', { short: 'l' }),
  markdown: Flag.string('Markdown content', { hidden: true }),
  tags: Flag.string('Tags to apply', { hidden: true }),
  rel: Flag.string('Related entity', { hidden: true }),
  follow: Flag.string('Follow file name', { hidden: true }),
  previous: Flag.string('Previous message ref', { hidden: true }),
  noEditor: Flag.bool('Skip opening editor', { hidden: true }),
  noAutoTag: Flag.bool('Skip automatic tagging from the archived-thread tag corpus', { default: false }),
  noAutoRel: Flag.bool('Skip automatic rel suggestion from the entity graph', { default: false }),
  slackFiles: Flag.string('Slack file attachments as JSON (used by slack:follow:message)', { hidden: true }),
  slackMessages: Flag.string('Slack messages with source IDs and files as JSON', { hidden: true }),
  link: Flag.string('Slack permalink identifying the captured message', { hidden: true }),
}

type Params = InferParams<typeof params>
type Result = { filePath: string }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'slack:new': { params: Params; result: Result }
  }
}

export default class SlackNewTask extends Command {
  static override description: CommandDescription = {
    name: 'slack:new',
    description: 'Create new Slack message.',
    params,
    postProcess: [validateAnyArgFlagExists('to', 'from', 'fromLink')],
  }

  async run({ args, context, tasks, rawArgs }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context
    let { to, from, when, summary, markdown } = args
    let { fromLink } = args
    const { category, tags, rel, follow, previous, noEditor, noAutoTag, noAutoRel, slackFiles } = args
    let resolvedLink = args.link

    // If first arg is a Slack link with no other context, treat as --from-link
    if (to && !from && !summary && !fromLink && /^https?:\/\/[^/]*\.slack\.com\/archives\//.test(to)) {
      fromLink = to
      to = undefined
      ;(args as Record<string, unknown>).to = undefined
    }

    // --from-link: fetch Slack message and derive from/to/markdown/when
    let messages: SlackCaptureMessage[] = args.slackMessages ? JSON.parse(args.slackMessages) : []
    if (fromLink) {
      const resolved = await this.resolveFromLink(fromLink, args, rawArgs, tasks, output)
      if (!resolved.ok) return resolved.result!
      ;({ from, to, markdown, when } = resolved)
      messages = resolved.messages
      resolvedLink = resolved.link ?? resolvedLink
    }

    // Collect slack files from either resolveFromLink or the slackFiles param
    const filesToCopy: SlackFileRef[] = slackFiles ? JSON.parse(slackFiles) : []

    const whenDate = when.plainDate

    let who = firstName(to || from || '')
    if (to && from) {
      who = `${firstName(from)} to ${firstName(to)}`
    }

    const ddfw = new DayDirFileWriter(whenDate)

    // Build the key for matching existing items
    const baseKey = `${when.time} > ${who} Slack`

    // A key hit only means "same message" when the links agree — distinct
    // same-minute messages (rapid DMs) must not replace each other. Walk
    // (2), (3)… until a slot whose link matches (a true re-capture), an empty
    // slot, or — when either side has no link (legacy files, non-link
    // captures) — settle on the original replace-in-place behavior.
    let dayDoc = await readDay(whenDate)
    let key = baseKey
    let existing = dayDoc.getCompleteItem(key, category)
    let existingDoc: MessageDocument | undefined
    let suffix = 2
    while (existing) {
      existingDoc = undefined
      try {
        existingDoc = MessageDocument.fromMarkdown(await readTextFile(path.join(ddfw.fullDir, existing.path)))
      } catch {
        // File may not exist, that's ok
      }
      const oldLink = existingDoc?.yaml['link']
      const differentMessage = !!resolvedLink && typeof oldLink === 'string' && oldLink !== resolvedLink
      if (!differentMessage) break
      key = `${baseKey} (${suffix})`
      suffix++
      existing = dayDoc.getCompleteItem(key, category)
    }

    const transcriptRuns = new Set<string>()
    summary ??= existingDoc?.summary
    if (fromLink && !summary) {
      messages = await prepareSlackVoiceTranscripts(messages, { output, signal: context.signal, runs: transcriptRuns })
      summary = (await summarizeSlackMessage(messages[0], messages.slice(1))) ?? 'Slack message'
    }
    if (fromLink) output.log(`  Summary:   ${summary}`)

    const whoSlug = slugify(who, { preserveCase: true, suggestedLength: 40 })
    const summarySlug = slugify(<string>summary, { preserveCase: true, suggestedLength: 30 })
    const partialSlug = summarySlug ? `${whoSlug}_${summarySlug}` : whoSlug
    const fileName = messageFileName(when, 'slack', partialSlug)

    // Preserve all user-curated YAML fields from existing file, then overwrite system-generated ones.
    const preservedYaml: Record<string, unknown> = { ...existingDoc?.yaml }
    let message = await updateSlackCapture({
      doc: new MessageDocument(
        {
          ...preservedYaml,
          from,
          to,
          when: when.toString(),
          medium: 'Slack',
          summary,
          ...(tags ? { tags } : {}),
          ...(rel ? { rel } : {}),
          ...(follow ? { follow } : {}),
          ...(previous ? { previous } : {}),
          ...(resolvedLink ? { link: resolvedLink } : {}),
        },
        existingDoc?.markdown ?? markdown ?? '',
      ),
      messages,
      day: whenDate,
      files: filesToCopy,
      captureSlug: path.basename(existing?.path ?? fileName, '.md'),
      output,
      signal: context.signal,
      transcriptRuns,
    })

    // Classify the completed conversation, including inline speech. Explicit
    // and preserved metadata still take precedence over automatic enrichment.
    const enrichInput = { to: to ?? from, from, summary, body: message.markdown }
    const wantAutoTag = !tags && !preservedYaml['tags'] && !noAutoTag
    const wantAutoRel = !rel && !preservedYaml['rel'] && !noAutoRel
    const [autoTags, autoRel] = await Promise.all([
      wantAutoTag ? autoTagMessage(enrichInput, SLACK_ENRICH) : Promise.resolve(undefined),
      wantAutoRel ? autoRelMessage(enrichInput, SLACK_ENRICH) : Promise.resolve(undefined),
    ])
    if (autoTags) output.log(`  Auto-tags: ${autoTags}`)
    if (autoRel) output.log(`  Auto-rel: ${autoRel.join('; ')}`)
    message = new MessageDocument(
      { ...message.yaml, ...(autoTags ? { tags: autoTags } : {}), ...(autoRel ? { rel: autoRel } : {}) },
      message.markdown,
    )
    const data = message.toMarkdown()

    let filePath
    try {
      if (existing) {
        filePath = existing.path
        await saveSlackCaptureUpdate(path.join(ddfw.fullDir, filePath), existingDoc, message)
      } else {
        filePath = await ddfw.write(fileName, data)
      }
    } catch (err) {
      return CommandResult.error(err as Error, 'Failed to write slack file')
    }

    // Add or replace entry in Day
    try {
      const value = `[${summary || ''}](${filePath})`
      dayDoc = dayDoc.setCompleteItem(key, value, { time: when.time, category })
      await writeDay(dayDoc)
    } catch (err) {
      return CommandResult.error(err as Error, 'Failed to write day item')
    }

    await clearSavedVoiceTranscripts(transcriptRuns, output)
    if (!noEditor) {
      openEditor([{ file: path.join(ddfw.fullDir, filePath), line: data.split('\n').length }])
      await delay(500)
    }

    output.log(`\n  Successfully created ${filePath}.\n`)

    return CommandResult.success({ filePath })
  }

  private async resolveFromLink(
    link: string,
    args: Params,
    rawArgs: Record<string, unknown>,
    tasks: CommandArgs<Params>['tasks'],
    output: { log: (msg: string) => void },
  ) {
    const exportResult = await tasks.run('slack:cli:export', { link })
    if (!exportResult.ok || !exportResult.data) {
      return {
        ok: false as const,
        result: CommandResult.fail<Result>(`Failed to export Slack message: ${exportResult.message}`),
      }
    }

    const data = exportResult.data

    // Default --when to message timestamp (converted to notebook timezone)
    const when = rawArgs.when
      ? args.when
      : data.message.timeLabel
        ? await convertToNotebookTimezone(data.message.timeLabel)
        : args.when

    // Derive from/to
    const from = args.from || data.message.userName
    const to = args.to || resolveRecipient(data, from)

    const messages = captureMessages(data)
    const markdown = args.markdown

    output.log(`  From link: ${from} → ${to}`)

    // The resolved permalink is the message's canonical identity — the same
    // message re-captured from any link form (workspace vs enterprise domain,
    // constructed archives URL) resolves to one spelling, so the replacement
    // gate compares like with like.
    return { ok: true as const, from, to, markdown, when, messages, link: data.message.permalink ?? link }
  }
}

// TODO: extract convertToNotebookTimezone and getDayTimezone into shared helpers (duplicated in heartbeat/follow-new.ts and service/handler/siteHtml.ts)
async function convertToNotebookTimezone(when: string): Promise<PlainDateTime> {
  const systemTimezone = currentTimezoneIANA()
  const inSystemTz = new ZonedDateTime(when, systemTimezone)
  const dayTimezone = await getDayTimezone(inSystemTz.date)

  if (systemTimezone === dayTimezone) {
    return PlainDateTime.fromString(when)
  }

  const inDayTz = inSystemTz.inTimeZone(dayTimezone)
  return PlainDateTime.fromString(`${inDayTz.date} ${inDayTz.time}`)
}

/** Extract first name from a display name. Handles channels (#general), group DMs (Alice Smith, Bob Jones → Alice, Bob). */
function firstName(name: string): string {
  if (name.startsWith('#')) return name
  return name
    .split(', ')
    .map((n) => n.split(' ')[0])
    .join(', ')
}

async function getDayTimezone(dateStr: string): Promise<string> {
  try {
    const plainDate = new PlainDate(dateStr)
    const df = path.join(DIR_TIME, dayFile(plainDate))
    const dayModel = DayDocument.fromMarkdown(await readTextFile(df))
    return dayModel.timezone
  } catch {
    return fetchNowSync().timezone
  }
}
