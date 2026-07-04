import * as path from 'node:path'
import ms from 'ms'
import { generateText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { DIR_HEARTBEAT_FOLLOW, DIR_TIME } from '#config'
import { exists, outputFile, readTextFile } from '#shared/fs/mod.ts'
import { computePreviousRef, fetchNowSync } from '#shared/nbfs/mod.ts'
import { DayDirFileWriter } from '#lib/nbfs/mod.ts'
import Follow from '#shared/models/Follow/mod.ts'
import SlackFollowRegistry from '#shared/models/Follow/SlackFollowRegistry.ts'
import slugify from '#lib/string/slugify.ts'
import { PlainDate, PlainDateTime, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import currentTimezoneIANA from '#universal/dates/timezones/currentTimezoneIANA.ts'
import DayDocument from '#shared/models/Day/mod.ts'
import dayFile from '#shared/nbfs/dayFile.ts'
import { resolveRecipient } from '#commands/all/slack/cli/export/helpers/mod.ts'
import { Arg, Command, CommandResult, Flag, whenNBTime } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'

const params = {
  link: Arg.string('Slack message link (workspace URL, app URL, or slack:// deeplink)'),
  interval: Flag.string('Check interval (e.g. 10m, 4h, 1d)', { short: 'i', default: () => '10m' }),
  expires: Flag.string(
    `Auto-expire deadline: duration from now (e.g. 7d, 2w) or datetime (YYYY-MM-DD [HH:mm]). Without it, the follow expires after ${Follow.DEFAULT_MAX_INACTIVE} of inactivity`,
    { short: 'e' },
  ),
  when: whenNBTime(),
}

type Params = InferParams<typeof params>
type Result = { file: string }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'slack:follow:new': {
      params: Params
      result: Result
    }
  }
}

export default class SlackFollowNewTask extends Command {
  static override description: CommandDescription = {
    name: 'slack:follow:new',
    description: 'Create a new follow from a Slack message link.',
    descriptionLong: [
      'Resolves channel name, message details, and thread info from a Slack link',
      'via slack:cli:export, then writes a Follow YAML file to the follow directory.',
    ],
    usage: [
      'sky slack:follow:new "https://workspace.slack.com/archives/C01234ABC/p1234567890123456"',
      'sky slack:follow:new "https://..." --interval 4h',
      'sky slack:follow:new "https://..." --expires 7d',
      'sky slack:follow:new "https://..." --expires "2026-07-20 09:00"',
    ],
    params,
  }

  async run({ args, context, tasks, rawArgs }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context
    const { link, interval } = args

    // Validate --expires up front, before any Slack work
    let expires: PlainDateTime | undefined
    if (args.expires) {
      expires = parseExpires(args.expires, fetchNowSync().plainDateTime)
      if (!expires) {
        return CommandResult.fail(
          `Invalid --expires: "${args.expires}" (use a duration like 7d, or a datetime like 2026-07-20 09:00)`,
        )
      }
    }

    // 0. Check for duplicate follow
    if (await exists(DIR_HEARTBEAT_FOLLOW)) {
      const registry = await SlackFollowRegistry.build()
      const dupe = registry.getAll().find((e) => e.follow.ref.link === link)
      if (dupe) {
        output.log(`Already following this link: ${dupe.follow.summary} (${dupe.fileName})`)
        return CommandResult.fail(`Duplicate follow: ${dupe.fileName}`)
      }
    }

    // 1. Resolve Slack message details (this is the initial follow/check)
    const exportResult = await tasks.run('slack:cli:export', { link })
    if (!exportResult.ok || !exportResult.data) {
      return CommandResult.fail(`Failed to export Slack message: ${exportResult.message}`)
    }

    const data = exportResult.data

    // Default --when to message timestamp (converted to notebook day's timezone)
    const when = rawArgs.when
      ? args.when
      : data.message.timeLabel
        ? await convertToNotebookTimezone(data.message.timeLabel)
        : args.when

    // 2. Summarize the message in 5-9 words
    const messageText = data.message.text.trim()
    let summary = 'Follow'
    if (messageText) {
      try {
        const { text } = await generateText({
          model: anthropic('claude-haiku-4-5-20251001'),
          prompt: `Summarize this Slack message in 5-7 words. Return ONLY the summary, no quotes or punctuation at the end.\n\n${messageText}`,
        })
        summary = text.trim()
      } catch {
        summary = messageText.slice(0, 80)
      }
    }

    // 3. Derive from/to/channel
    const from = data.message.userName
    const channel = data.channelName || data.channelId
    const to = resolveRecipient(data, from)

    // 3b. Generate follow filename (needed before slack:new to pass as follow: reference)
    const channelSlug = slugify(channel, { preserveCase: true })
    const summarySlug = slugify(summary, { preserveCase: true, suggestedLength: 40 })
    const datePrefix = when.plainDate.toString()
    const fileName = `${datePrefix}_slack_${channelSlug}_${summarySlug}.yaml`
    const fileNameNoExt = fileName.replace(/\.yaml$/, '')

    // 3c. Smart split: if no --when AND root message is before today AND thread has replies,
    //     split messages across their actual days instead of lumping everything on one day.
    const today = PlainDate.today()
    const hasThread = data.thread && data.thread.replies.length > 0
    const shouldSmartSplit = !rawArgs.when && when.plainDate.toString() < today.toString() && hasThread

    let initialMessages: { date: string; path: string }[] = []

    // Collect all file references from the export result
    type FileRef = { mimetype?: string; mode?: string; path: string }
    const rootFiles: FileRef[] = data.message.files ?? []
    const replyFiles: FileRef[][] = data.thread?.replies.map((r) => r.files ?? []) ?? []

    if (shouldSmartSplit) {
      // Collect all messages (root + replies) with their notebook-timezone times
      type DayMsg = { timeLabel: string; userName: string; text: string; when: PlainDateTime; files: FileRef[] }

      const rootMsg: DayMsg = {
        timeLabel: data.message.timeLabel || '',
        userName: data.message.userName || '-',
        text: messageText || '(empty)',
        when,
        files: rootFiles,
      }

      const allMessages: DayMsg[] = [rootMsg]
      for (let ri = 0; ri < data.thread!.replies.length; ri++) {
        const reply = data.thread!.replies[ri]
        const replyWhen = reply.timeLabel ? await convertToNotebookTimezone(reply.timeLabel) : when
        allMessages.push({
          timeLabel: reply.timeLabel || reply.ts || '',
          userName: reply.userName || reply.userId || '-',
          text: reply.text || '(empty)',
          when: replyWhen,
          files: replyFiles[ri] ?? [],
        })
      }

      // Group by notebook date
      const byDay = new Map<string, DayMsg[]>()
      for (const msg of allMessages) {
        const dateStr = msg.when.plainDate.toString()
        if (!byDay.has(dateStr)) byDay.set(dateStr, [])
        byDay.get(dateStr)!.push(msg)
      }

      const sortedDays = [...byDay.keys()].sort()
      output.log(`  Smart split: ${allMessages.length} messages across ${sortedDays.length} days`)

      for (let i = 0; i < sortedDays.length; i++) {
        const dayStr = sortedDays[i]
        const dayMessages = byDay.get(dayStr)!
        const dayWhen = dayMessages[0].when

        // Build markdown body for this day's messages
        const bodyParts: string[] = [`# ${summary}`, '']
        for (const msg of dayMessages) {
          bodyParts.push(`## ${msg.timeLabel} - **${msg.userName}**`, '')
          bodyParts.push(msg.text, '', '')
        }

        // Compute previous ref from prior day's entry
        let previous: string | undefined
        if (i > 0 && initialMessages.length > 0) {
          const lastEntry = initialMessages[initialMessages.length - 1]
          previous = computePreviousRef(lastEntry.path, dayWhen.plainDate)
        }

        const dayFiles = dayMessages.flatMap((m) => m.files)
        const slackResult = await tasks.run('slack:new', {
          from,
          to,
          summary,
          when: dayWhen,
          markdown: bodyParts.join('\n'),
          follow: fileNameNoExt,
          ...(previous ? { previous } : {}),
          ...(dayFiles.length > 0 ? { slackFiles: JSON.stringify(dayFiles) } : {}),
          noEditor: true,
        })

        const relPath = slackResult.ok ? slackResult.data?.filePath : undefined
        if (relPath) {
          const ddfw = new DayDirFileWriter(dayWhen.plainDate)
          initialMessages.push({ date: dayStr, path: `time/${ddfw.dayDir}/${relPath}` })
          output.log(`  ${dayStr}: ${relPath} (${dayMessages.length} message${dayMessages.length > 1 ? 's' : ''})`)
        }
      }
    } else {
      // Standard path: single file with all messages on one day
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

      const allFiles = [...rootFiles, ...replyFiles.flat()]
      const slackResult = await tasks.run('slack:new', {
        from,
        to,
        summary,
        when,
        markdown: bodyParts.length > 0 ? bodyParts.join('\n') : undefined,
        follow: fileNameNoExt,
        ...(allFiles.length > 0 ? { slackFiles: JSON.stringify(allFiles) } : {}),
      })

      const slackFilePath = slackResult.ok ? slackResult.data?.filePath : undefined
      if (slackFilePath) {
        const ddfw = new DayDirFileWriter(when.plainDate)
        initialMessages = [{ date: when.plainDate.toString(), path: `time/${ddfw.dayDir}/${slackFilePath}` }]
      }
    }

    // 4. Build follow with lastChecked set (initial check just happened)
    const now = fetchNowSync().plainDateTime

    const follow = Follow.create({
      source: 'Slack',
      ref: {
        channel: data.channelId,
        ...(data.threadTs ? { thread_ts: data.threadTs } : {}),
        link: data.link,
      },
      summary,
      checkInterval: interval,
      followSince: now,
      expires,
      lastChecked: now,
      lastActivity: now,
      messages: initialMessages,
      status: 'active',
    })

    // 5. Write follow YAML
    const filePath = path.join(DIR_HEARTBEAT_FOLLOW, fileName)

    await outputFile(filePath, follow.toYaml())

    // 6. Log success
    output.log('')
    output.log(`Created follow: ${fileName}`)
    output.log(`  Source:   Slack`)
    output.log(`  Channel:  ${to}`)
    output.log(`  Summary:  ${summary}`)
    output.log(`  Interval: ${interval}`)
    if (expires) output.log(`  Expires:  ${expires.date} ${expires.time}`)
    output.log(`  Messages: ${initialMessages.length} day${initialMessages.length !== 1 ? 's' : ''}`)
    output.log(`  Follow:   ${filePath}`)
    output.log('')

    return CommandResult.success({ file: filePath })
  }
}

/**
 * Parse an --expires value: a bare date means end of that day; durations
 * require a unit (a bare number would be milliseconds — reject it).
 */
function parseExpires(value: string, now: PlainDateTime): PlainDateTime | undefined {
  const trimmed = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return PlainDateTime.fromString(`${trimmed} 23:59`)
  if (/^\d{4}-\d{2}-\d{2} \d{1,2}:\d{2}$/.test(trimmed)) return PlainDateTime.fromString(trimmed)
  if (/[a-z]/i.test(trimmed)) {
    const durationMs = ms(trimmed as ms.StringValue)
    if (durationMs !== undefined && durationMs > 0) {
      return now.addHours(durationMs / 3_600_000).normalize()
    }
  }
  return undefined
}

// TODO: extract convertToNotebookTimezone and getDayTimezone into shared helpers (duplicated in service/handler/siteHtml.ts)
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
