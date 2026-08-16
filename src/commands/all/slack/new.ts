import { unlink } from 'node:fs/promises'
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
import { copySlackFilesToAttachments, type SlackFileRef } from './lib/copyToAttachments.ts'
import { SLACK_ENRICH } from './lib/enrich.ts'
import resolveRecipient from './lib/resolveRecipient.ts'
import { summarizeSlackMessage } from './lib/summarize.ts'

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
  slackFiles: Flag.string('Slack file attachments as JSON (used by slack:follow:new)', { hidden: true }),
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

    // --from-link: fetch Slack message and derive from/to/summary/markdown/when
    let resolvedFiles: SlackFileRef[] | undefined
    if (fromLink) {
      const resolved = await this.resolveFromLink(fromLink, args, rawArgs, tasks, output)
      if (!resolved.ok) return resolved.result!
      ;({ from, to, summary, markdown, when } = resolved)
      resolvedFiles = resolved.slackFiles
      resolvedLink = resolved.link ?? resolvedLink
    }

    // Collect slack files from either resolveFromLink or the slackFiles param
    const filesToCopy: SlackFileRef[] = resolvedFiles ?? (slackFiles ? (JSON.parse(slackFiles) as SlackFileRef[]) : [])

    const whenDate = when.plainDate

    // Copy file attachments to notebook attachments directory
    const attachments = filesToCopy.length > 0 ? await copySlackFilesToAttachments(filesToCopy, whenDate, output) : []

    let who = firstName(to || from || '')
    if (to && from) {
      who = `${firstName(from)} to ${firstName(to)}`
    }

    const whoSlug = slugify(who, { preserveCase: true, suggestedLength: 40 })
    const summarySlug = slugify(<string>summary, { preserveCase: true, suggestedLength: 30 })
    const partialSlug = summarySlug ? `${whoSlug}_${summarySlug}` : whoSlug
    const fileName = messageFileName(when, 'slack', partialSlug)

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

    // Preserve all user-curated YAML fields from existing file, then overwrite system-generated ones
    let preservedYaml: Record<string, unknown> = {}
    if (existing) {
      preservedYaml = { ...existingDoc?.yaml }
      try {
        await unlink(path.join(ddfw.fullDir, existing.path))
        output.log(`  Replacing existing Slack entry (deleted ${existing.path})`)
      } catch {
        // File may not exist, that's ok
      }
    }

    // Auto-enrich only fields with no value in play — caller-supplied values
    // (follow inheritance, --tags/--rel) and preserved hand edits always win.
    const enrichInput = { to: to ?? from, from, summary, body: markdown ?? '' }
    const wantAutoTag = !tags && !preservedYaml['tags'] && !noAutoTag
    const wantAutoRel = !rel && !preservedYaml['rel'] && !noAutoRel
    const [autoTags, autoRel] = await Promise.all([
      wantAutoTag ? autoTagMessage(enrichInput, SLACK_ENRICH) : Promise.resolve(undefined),
      wantAutoRel ? autoRelMessage(enrichInput, SLACK_ENRICH) : Promise.resolve(undefined),
    ])
    const resolvedTags = tags ?? autoTags
    if (autoTags) output.log(`  Auto-tags: ${autoTags}`)
    if (autoRel) output.log(`  Auto-rel: ${autoRel.join('; ')}`)

    const message = new MessageDocument({
      ...preservedYaml,
      from,
      to,
      when,
      medium: 'Slack',
      summary,
      ...(attachments.length > 0 ? { attachments } : {}),
      ...(resolvedTags ? { tags: resolvedTags } : {}),
      ...(rel ? { rel } : autoRel ? { rel: autoRel } : {}),
      ...(follow ? { follow } : {}),
      ...(previous ? { previous } : {}),
      ...(resolvedLink ? { link: resolvedLink } : {}),
    })
    let data = message.toMarkdown()

    if (markdown) {
      data += markdown
    }

    let filePath
    try {
      filePath = await ddfw.write(fileName, data)
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

    // Summarize the message (thread replies included — the root is often just a header)
    const messageText = data.message.text.trim()
    let summary = args.summary
    if (!summary) summary = await summarizeSlackMessage(data.message, data.thread?.replies)
    if (!summary) summary = 'Slack message'

    // Derive from/to
    const from = args.from || data.message.userName
    const to = args.to || resolveRecipient(data, from)

    // Build markdown body
    const bodyParts: string[] = [`# ${summary}`, '']
    const msgWho = data.message.userName || '-'
    const msgTime = data.message.timeLabel || ''
    bodyParts.push(`## ${msgTime} - **${msgWho}**`, '')
    bodyParts.push(messageText || '(empty)', '', '')
    if (data.thread && data.thread.replies.length > 0) {
      for (const reply of data.thread.replies) {
        const who = reply.userName || reply.userId || '-'
        bodyParts.push(`## ${reply.timeLabel || reply.ts} - **${who}**`, '')
        bodyParts.push(reply.text || '(empty)', '', '')
      }
    }

    const markdown = args.markdown ? args.markdown + '\n' + bodyParts.join('\n') : bodyParts.join('\n')

    // Collect all file references from root + thread (copying happens in run())
    const slackFiles: SlackFileRef[] = [
      ...(data.message.files ?? []),
      ...(data.thread?.replies.flatMap((r) => r.files ?? []) ?? []),
    ]

    output.log(`  From link: ${from} → ${to}`)
    output.log(`  Summary:   ${summary}`)

    // The resolved permalink is the message's canonical identity — the same
    // message re-captured from any link form (workspace vs enterprise domain,
    // constructed archives URL) resolves to one spelling, so the replacement
    // gate compares like with like.
    return { ok: true as const, from, to, summary, markdown, when, slackFiles, link: data.message.permalink ?? link }
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
