import * as path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import ms from 'ms'
import openEditor from 'open-editor'
import { SLACK_ENRICH } from '#commands/all/slack/lib/enrich.ts'
import { resolveRecipient } from '#commands/all/slack/lib/mod.ts'
import parseMessageLink from '#commands/all/slack/lib/parseMessageLink.ts'
import { summarizeSlackMessage } from '#commands/all/slack/lib/summarize.ts'
import { Arg, Command, CommandResult, Flag, whenNBTime } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { DIR_BASE, DIR_STATE_FOLLOW_SLACK_ACTIVE, DIR_STATE_FOLLOW_SLACK_ARCHIVE } from '#config'
import { DayDirFileWriter } from '#lib/nbfs/mod.ts'
import { autoRelMessage } from '#lib/notebook/enrich/autoRel.ts'
import { autoTagMessage } from '#lib/notebook/enrich/autoTag.ts'
import slugify from '#lib/string/slugify.ts'
import { outputFile, readTextFile, writeTextFile } from '#shared/fs/mod.ts'
import Follow from '#shared/models/Follow/mod.ts'
import SlackFollowRegistry from '#shared/models/Follow/SlackFollowRegistry.ts'
import MessageDocument from '#shared/models/Message/mod.ts'
import { computePreviousRef, convertToNotebookTimezone, fetchNowSync, toTimeRef } from '#shared/nbfs/mod.ts'
import { PlainDate, PlainDateTime } from '#universal/dates/nbdt/mod.ts'

const params = {
  link: Arg.string('Slack message link (workspace URL, app URL, or slack:// deeplink)'),
  interval: Flag.string('Check interval (e.g. 10m, 4h, 1d)', { short: 'i', default: () => '10m' }),
  expires: Flag.string(
    `Auto-expire deadline: duration from now (e.g. 7d, 2w) or datetime (YYYY-MM-DD [HH:mm]). Without it, the follow expires after ${Follow.DEFAULT_MAX_INACTIVE} of inactivity`,
    { short: 'e' },
  ),
  when: whenNBTime(),
  force: Flag.bool('Capture even when the thread is already captured, or inactive past the expiry window', {
    default: false,
  }),
  check: Flag.bool(
    'Report whether the link is already in the follow registry (active or archive) and stop — no Slack fetch, no capture',
    {
      default: false,
    },
  ),
  noEditor: Flag.bool('Skip opening editors for created files', { hidden: true, default: false }),
}

type Params = InferParams<typeof params>
type Result = {
  /** Follow YAML path — active for live threads, a born-closed archive record for quiet ones, the matching record on --check */
  file?: string
  followed: boolean
  /** --check only: whether the link is already in the follow registry (active or archive) */
  inRegistry?: boolean
  /** Notebook-relative paths (time/...) of the slack files written */
  slackFiles: string[]
}

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'slack:follow:message': {
      params: Params
      result: Result
    }
  }
}

export default class SlackFollowMessageTask extends Command {
  static override description: CommandDescription = {
    name: 'slack:follow:message',
    description: 'Create a new follow from a Slack message link.',
    descriptionLong: [
      'Resolves channel name, message details, and thread info from a Slack link',
      'via slack:cli:export, then writes a Follow YAML file to the follow directory.',
      '',
      'A link into an already-captured thread is declined — the earlier capture',
      'holds the whole thread, identified by channel + root ts across the active',
      'and archive follow ledgers (--force to capture anyway).',
      '',
      '--check reports whether the link is already in those ledgers and stops —',
      'no Slack fetch, no capture. Identity comes from the link alone, so a',
      'reply link without a thread_ts param only matches by exact link string.',
    ],
    usage: [
      'sky slack:follow:message "https://workspace.slack.com/archives/C01234ABC/p1234567890123456"',
      'sky slack:follow:message "https://..." --interval 4h',
      'sky slack:follow:message "https://..." --expires 7d',
      'sky slack:follow:message "https://..." --expires "2026-07-20 09:00"',
      'sky slack:follow:message "https://..." --check',
    ],
    params,
  }

  async run({ args, context, tasks, rawArgs }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context
    const { link, interval } = args

    // --check: answer "is this link already in the follow ledgers?" from the
    // registry alone — no Slack fetch, no capture, no follow.
    if (args.check) {
      const parsed = parseMessageLink(link)
      const match = await findCapturedThread(link, parsed)
      if (match) {
        output.log(`In registry (${match.ledger}): ${match.summary} (${match.fileName})`)
        return CommandResult.success({ file: match.path, followed: false, inRegistry: true, slackFiles: [] })
      }
      output.log('Not in registry.')
      if (!parsed) output.log('  (link form not parseable locally — only exact link strings were compared)')
      return CommandResult.success({ followed: false, inRegistry: false, slackFiles: [] })
    }

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

    // 0. Decline duplicates before any Slack work. Identity is channel + root
    //    ts — never link strings, one thread wears many URL spellings — and a
    //    root p-link names the thread key directly. A bare reply p-link only
    //    names its own ts, so it can pass here; the post-export check below
    //    catches it once Slack reveals the true root.
    if (!args.force) {
      const dupe = await findCapturedThread(link, parseMessageLink(link))
      if (dupe) {
        output.log(`Thread already captured: ${dupe.summary} (${dupe.fileName})`)
        return CommandResult.fail(
          `${dupe.ledger === 'active' ? 'Duplicate follow' : 'Already captured'}: ${dupe.fileName}`,
        )
      }
    }

    // 1. Resolve Slack message details (this is the initial follow/check)
    const exportResult = await tasks.run('slack:cli:export', { link })
    if (!exportResult.ok || !exportResult.data) {
      return CommandResult.fail(`Failed to export Slack message: ${exportResult.message}`)
    }

    const data = exportResult.data

    // A link into an already-captured thread must not create a second copy —
    // the earlier capture holds the whole thread. The pre-export check misses
    // only when the link alone can't name the thread root (a bare reply
    // p-link, an unparseable form); the export just resolved the real
    // identity, so check the ledgers once more. Thread roots carry
    // thread_ts === ts, and bare messages fall back to their own ts, which
    // findByThreadRoot matches out of a stored ref.link.
    if (!args.force) {
      const rootTs = data.threadTs ?? data.messageTs
      const owner = await findCapturedThread(link, { channelId: data.channelId, rootTs })
      if (owner) {
        output.log(`Thread already captured: ${owner.summary} (${owner.fileName})`)
        return CommandResult.fail(
          `${owner.ledger === 'active' ? 'Duplicate follow' : 'Already captured'}: ${owner.fileName}`,
        )
      }
    }

    // Default --when to message timestamp (converted to notebook day's timezone)
    const when = rawArgs.when
      ? args.when
      : data.message.timeLabel
        ? await convertToNotebookTimezone(data.message.timeLabel)
        : args.when

    // 2. Summarize in 5-7 words (thread replies included — the root is often just a header)
    const messageText = data.message.text.trim()
    const summary = (await summarizeSlackMessage(data.message, data.thread?.replies)) ?? 'Follow'

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

    // lastActivity is the thread's real last message time, not now — a follow
    // created on a quiet thread must not look freshly active, or backoff and
    // expiry anchor on a fiction.
    const lastReplyLabel = data.thread?.replies.at(-1)?.timeLabel
    const lastActivity = lastReplyLabel ? await convertToNotebookTimezone(lastReplyLabel) : when
    const now = fetchNowSync().plainDateTime

    const wholeThreadBody = (): string => {
      const bodyParts: string[] = [`# ${summary}`, '']
      bodyParts.push(`## ${data.message.timeLabel || ''} - **${data.message.userName || '-'}**`, '')
      bodyParts.push(messageText || '(empty)', '', '')
      for (const reply of data.thread?.replies ?? []) {
        bodyParts.push(`## ${reply.timeLabel || reply.ts} - **${reply.userName || reply.userId || '-'}**`, '')
        bodyParts.push(reply.text || '(empty)', '', '')
      }
      return bodyParts.join('\n')
    }

    // A follow that would be born expired is declined: a thread already quiet
    // past the inactivity window is an archive, not something to watch.
    const candidate = Follow.create({
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
      lastActivity,
      messages: [],
      status: 'active',
    })
    if (!args.force && candidate.isExpired(now)) {
      output.log(
        `  Thread inactive since ${lastActivity.date} (over ${Follow.DEFAULT_MAX_INACTIVE}) — archiving without a follow (--force to follow anyway).`,
      )
      const allFiles = [...rootFiles, ...replyFiles.flat()]
      const slackResult = await tasks.run('slack:new', {
        from,
        to,
        summary,
        when,
        markdown: wholeThreadBody(),
        link: data.message.permalink ?? link,
        ...(allFiles.length > 0 ? { slackFiles: JSON.stringify(allFiles) } : {}),
        ...(args.noEditor ? { noEditor: true } : {}),
      })
      const relPath = slackResult.ok ? slackResult.data?.filePath : undefined
      if (!relPath) {
        return CommandResult.fail(`Failed to archive thread: ${slackResult.ok ? 'no file path' : slackResult.message}`)
      }
      const ddfw = new DayDirFileWriter(when.plainDate)
      const timePath = `time/${ddfw.dayDir}/${relPath}`
      // Born-closed ledger record: every captured thread leaves a follow YAML,
      // so the already-captured check never needs to search the notebook itself
      const archived = candidate.addMessage(when.plainDate.toString(), toTimeRef(timePath)).updateStatus('closed')
      const archivedPath = path.join(DIR_STATE_FOLLOW_SLACK_ARCHIVE, fileName)
      await outputFile(archivedPath, archived.toYaml())
      return CommandResult.success({ file: archivedPath, followed: false, slackFiles: [timePath] })
    }

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

      // One thread-level classification over the full transcript; every split
      // day gets the same tags. Per-day auto-tag stays off either way — day
      // bodies are fragments (day 1 is often just the root header) and would
      // classify inconsistently.
      const fullBodyParts: string[] = [`# ${summary}`, '']
      for (const msg of allMessages) {
        fullBodyParts.push(`## ${msg.timeLabel} - **${msg.userName}**`, '')
        fullBodyParts.push(msg.text, '', '')
      }
      const enrichInput = { to, from, summary, body: fullBodyParts.join('\n') }
      const [threadTags, threadRel] = await Promise.all([
        autoTagMessage(enrichInput, SLACK_ENRICH),
        autoRelMessage(enrichInput, SLACK_ENRICH),
      ])
      if (threadTags) output.log(`  Auto-tags: ${threadTags}`)
      if (threadRel) output.log(`  Auto-rel: ${threadRel.join('; ')}`)

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
          link: data.message.permalink ?? link,
          ...(threadTags ? { tags: threadTags } : { noAutoTag: true }),
          noAutoRel: true,
          ...(previous ? { previous } : {}),
          ...(dayFiles.length > 0 ? { slackFiles: JSON.stringify(dayFiles) } : {}),
          noEditor: true,
        })

        const relPath = slackResult.ok ? slackResult.data?.filePath : undefined
        if (relPath) {
          const ddfw = new DayDirFileWriter(dayWhen.plainDate)
          const fullTimePath = `time/${ddfw.dayDir}/${relPath}`
          initialMessages.push({ date: dayStr, path: fullTimePath })
          output.log(`  ${dayStr}: ${relPath} (${dayMessages.length} message${dayMessages.length > 1 ? 's' : ''})`)

          // rel is an array, which the slack:new string param can't carry —
          // patch it onto the written file (same trick as follow:check)
          if (threadRel) {
            try {
              const absPath = path.join(DIR_BASE, fullTimePath)
              const doc = MessageDocument.fromMarkdown(await readTextFile(absPath))
              await writeTextFile(
                absPath,
                new MessageDocument({ ...doc.yaml, rel: threadRel }, doc.markdown).toMarkdown(),
              )
            } catch {
              // day file unreadable — leave rel absent
            }
          }
        }
      }

      // The per-day writes ran with noEditor — open everything created for review
      if (initialMessages.length > 0 && !args.noEditor) {
        openEditor(initialMessages.map((m) => ({ file: path.join(DIR_BASE, m.path) })))
        await delay(500)
      }
    } else {
      // Standard path: single file with all messages on one day
      const allFiles = [...rootFiles, ...replyFiles.flat()]
      const slackResult = await tasks.run('slack:new', {
        from,
        to,
        summary,
        when,
        markdown: wholeThreadBody(),
        follow: fileNameNoExt,
        link: data.message.permalink ?? link,
        ...(allFiles.length > 0 ? { slackFiles: JSON.stringify(allFiles) } : {}),
        ...(args.noEditor ? { noEditor: true } : {}),
      })

      const slackFilePath = slackResult.ok ? slackResult.data?.filePath : undefined
      if (slackFilePath) {
        const ddfw = new DayDirFileWriter(when.plainDate)
        initialMessages = [{ date: when.plainDate.toString(), path: `time/${ddfw.dayDir}/${slackFilePath}` }]
      }
    }

    // 4. Build follow with lastChecked set (initial check just happened)
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
      lastActivity,
      // Stored as time refs — initialMessages keeps real paths for the editor.
      messages: initialMessages.map((m) => ({ date: m.date, path: toTimeRef(m.path) })),
      status: 'active',
    })

    // 5. Write follow YAML
    const filePath = path.join(DIR_STATE_FOLLOW_SLACK_ACTIVE, fileName)

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

    return CommandResult.success({ file: filePath, followed: true, slackFiles: initialMessages.map((m) => m.path) })
  }
}

type CapturedThread = { fileName: string; path: string; summary: string; ledger: 'active' | 'archive' }

/**
 * Find the ledger record already holding a message's thread, across the
 * active and archive follow dirs. Identity is channel + root ts first — one
 * thread wears many URL spellings (workspace vs enterprise hosts, thread_ts
 * params) — with exact link equality as the fallback for links that don't
 * parse. Archive counts: every capture leaves a record there even when
 * nothing is actively followed.
 */
export async function findCapturedThread(
  link: string,
  parsed: { channelId: string; rootTs: string } | undefined,
  dirs = { active: DIR_STATE_FOLLOW_SLACK_ACTIVE, archive: DIR_STATE_FOLLOW_SLACK_ARCHIVE },
): Promise<CapturedThread | undefined> {
  const ledgers = [
    { dir: dirs.active, ledger: 'active' as const },
    { dir: dirs.archive, ledger: 'archive' as const },
  ]
  for (const { dir, ledger } of ledgers) {
    const registry = await SlackFollowRegistry.build(dir)
    const match =
      (parsed ? registry.findByThreadRoot(parsed.channelId, parsed.rootTs) : undefined) ??
      registry
        .getAll()
        .find((e) => e.follow.ref.link === link || e.follow.merged.some((anchor) => anchor.link === link))
    if (match) return { fileName: match.fileName, path: match.path, summary: match.follow.summary, ledger }
  }
  return undefined
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
