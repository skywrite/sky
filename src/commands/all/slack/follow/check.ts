import { unlink } from 'node:fs/promises'
import * as path from 'node:path'
import { checkChannelWatches, type ChannelWatchCheckResult } from '#commands/all/slack/lib/checkChannelWatches.ts'
import { copySlackFilesToAttachments } from '#commands/all/slack/lib/copyToAttachments.ts'
import { resolveRecipient } from '#commands/all/slack/lib/mod.ts'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { DIR_BASE, DIR_STATE_FOLLOW_SLACK_ACTIVE, DIR_STATE_FOLLOW_SLACK_ARCHIVE } from '#config'
import { DayDirFileWriter } from '#lib/nbfs/mod.ts'
import { exists, outputFile, readTextFile, writeTextFile } from '#shared/fs/mod.ts'
import Follow from '#shared/models/Follow/mod.ts'
import SlackFollowRegistry from '#shared/models/Follow/SlackFollowRegistry.ts'
import MessageDocument from '#shared/models/Message/mod.ts'
import {
  computePreviousRef,
  convertToNotebookTimezone,
  fetchNow,
  fetchNowSync,
  resolveTimeRef,
  toTimeRef,
} from '#shared/nbfs/mod.ts'

const params = {
  file: Flag.string('Check a specific follow by filename (skip due filtering)', { short: 'f' }),
}

type Params = InferParams<typeof params>

type CheckSummary = { fileName: string; newReplies: number }
type Result = {
  checked: number
  expired: string[]
  skipped: string[]
  errors: string[]
  withActivity: CheckSummary[]
  channels: ChannelWatchCheckResult
}

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'slack:follow:check': {
      params: Params
      result: Result
    }
  }
}

export default class SlackFollowCheckTask extends Command {
  static override description: CommandDescription = {
    name: 'slack:follow:check',
    description: 'Poll due follows for new activity.',
    descriptionLong: [
      'Loads the follow registry and first auto-expires dead follows — past their',
      `expires deadline, or inactive longer than ${Follow.DEFAULT_MAX_INACTIVE} when no expires is set.`,
      'Then finds follows past their check interval, polls Slack for new thread',
      'replies, saves new messages, and updates lastChecked.',
      '',
      'Channel watches run first: root messages newer than each watch cursor',
      'are captured via slack:follow:message and the cursor advances.',
    ],
    usage: ['sky slack:follow:check', 'sky slack:follow:check --file slack_dm-with-jp_1771210504_352289'],
    params,
  }

  async run({ args, context, tasks }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context

    // Channel watches run first — they only spawn new follows, and they must
    // run even when no thread follow exists or is due. --file targets one
    // thread follow, so it skips the channel pass.
    const channels: ChannelWatchCheckResult = args.file
      ? { checked: 0, captured: 0, alreadyCaptured: 0, errors: [] }
      : await checkChannelWatches({ tasks, output })

    if (!(await exists(DIR_STATE_FOLLOW_SLACK_ACTIVE))) {
      output.log('No follow directory found.')
      return CommandResult.success({ checked: 0, expired: [], skipped: [], errors: [], withActivity: [], channels })
    }

    const now = fetchNowSync()
    const nowDt = now.plainDateTime
    const registry = await SlackFollowRegistry.build()

    // Auto-expire dead follows before polling (--file skips this: it's the
    // escape hatch to force-check a specific follow regardless of expiry)
    const expired: string[] = []
    if (!args.file) {
      for (const entry of registry.getActive()) {
        const { follow } = entry
        if (!follow.isExpired(nowDt)) continue

        const inactiveMs = follow.inactivityMs(nowDt)
        const reason = follow.expires
          ? `expires ${follow.expires.date} ${follow.expires.time} passed`
          : inactiveMs === Infinity
            ? 'no activity recorded'
            : `inactive ${Math.floor(inactiveMs / 86_400_000)}d >= ${Follow.DEFAULT_MAX_INACTIVE}`

        const closed = follow.updateStatus('closed')
        await outputFile(path.join(DIR_STATE_FOLLOW_SLACK_ARCHIVE, `${entry.fileName}.yaml`), closed.toYaml())
        await unlink(entry.path)
        output.log(`[expire] ${entry.fileName}: ${reason}`)
        expired.push(entry.fileName)
      }
    }

    // Get entries to check
    const expiredSet = new Set(expired)
    let entries = args.file
      ? (() => {
          const found = registry.findByFileName(args.file)
          return found ? [{ ...found, fileName: args.file }] : []
        })()
      : registry.getDue(nowDt).filter((e) => !expiredSet.has(e.fileName))

    if (entries.length === 0) {
      return CommandResult.success({ checked: 0, expired, skipped: [], errors: [], withActivity: [], channels })
    }

    const withActivity: CheckSummary[] = []
    const skipped: string[] = []
    const errors: string[] = []

    for (const entry of entries) {
      try {
        let { follow } = entry
        const { path: followPath, fileName } = entry

        if (!follow.ref.link) {
          output.log(`[check] ${fileName}: no link in ref, skipping`)
          skipped.push(`${fileName}: no link`)
          continue
        }

        // 1. Poll Slack
        const exportResult = await tasks.run('slack:cli:export', { link: follow.ref.link })
        if (!exportResult.ok || !exportResult.data) {
          output.log(`[check] ${fileName}: export failed — ${exportResult.message}`)
          skipped.push(`${fileName}: ${exportResult.message}`)
          continue
        }

        const data = exportResult.data

        // 2. Detect new replies since lastChecked
        // Normalize extended hours (e.g. 2026-02-24 31:04 → 2026-02-25 07:04)
        // so the string comparison matches Slack's wall-clock timeLabel format
        const lastCheckedNorm = follow.lastChecked?.normalize()
        const lastCheckedStr = lastCheckedNorm ? `${lastCheckedNorm.date} ${lastCheckedNorm.time}` : ''

        const newReplies = (data.thread?.replies ?? []).filter((r) =>
          r.timeLabel ? r.timeLabel > lastCheckedStr : false,
        )

        // 3. If new replies, create message via slack:new (handles merge, day entry, YAML preservation)
        if (newReplies.length > 0) {
          const latestReply = newReplies[newReplies.length - 1]
          const from = latestReply.userName || latestReply.userId || '-'
          const to = resolveRecipient(data, from)

          // The capture is dated by the newest reply's real time, never the
          // check time — a reply discovered after midnight (backoff, quiet
          // hours) must land in the day it was sent, not the day the check
          // happened to run.
          const lastActivityAt = latestReply.timeLabel ? await convertToNotebookTimezone(latestReply.timeLabel) : nowDt
          const activityDayStr = lastActivityAt.plainDate.toString()

          // Collect file attachments from new replies
          const newReplyFiles = newReplies.flatMap((r) => r.files ?? [])

          // Build markdown body: ## datetime - **name** for each new reply
          const replyParts: string[] = []
          for (const reply of newReplies) {
            const who = reply.userName || reply.userId || '-'
            replyParts.push(`## ${reply.timeLabel || reply.ts} - **${who}**`, '')
            replyParts.push(reply.text || '(empty)', '', '')
          }

          // Compute previous as a relative ref (DD/subpath, MM-DD/subpath, or
          // YYYY-MM-DD/subpath). Follow entries are time refs (older follows:
          // paths in any layout); resolveTimeRef reads them all.
          const lastMsg = follow.messages.length > 0 ? follow.messages[follow.messages.length - 1] : undefined
          const previous = lastMsg
            ? computePreviousRef(resolveTimeRef(lastMsg.path), lastActivityAt.plainDate)
            : undefined

          // Inherit tags and rel from previous message file
          let inheritedTags: string | undefined
          let inheritedRel: unknown // rel can be string or array in YAML
          if (lastMsg) {
            try {
              const prevDoc = MessageDocument.fromMarkdown(
                await readTextFile(path.join(DIR_BASE, resolveTimeRef(lastMsg.path))),
              )
              inheritedTags = prevDoc.yaml['tags'] as string | undefined
              inheritedRel = prevDoc.yaml['rel']
            } catch {
              /* previous file may not exist */
            }
          }

          // Check if we already have a message file for that day (same-day update)
          const dayMessage = follow.messages.find((m) => m.date === activityDayStr)

          if (dayMessage) {
            // Same-day update: append new replies to existing file, don't touch day entry
            const fullPath = path.join(DIR_BASE, resolveTimeRef(dayMessage.path))
            const oldDoc = MessageDocument.fromMarkdown(await readTextFile(fullPath))
            // Copy any new file attachments and merge with existing
            const newAttachments =
              newReplyFiles.length > 0
                ? await copySlackFilesToAttachments(newReplyFiles, lastActivityAt.plainDate, output)
                : []
            const existingAttachments = oldDoc.attachments
            const mergedAttachments = [...existingAttachments, ...newAttachments]
            const updatedDoc = new MessageDocument(
              {
                ...oldDoc.yaml,
                ...(mergedAttachments.length > 0 ? { attachments: mergedAttachments } : {}),
              },
              oldDoc.markdown,
            )
            await writeTextFile(fullPath, updatedDoc.toMarkdown() + replyParts.join('\n'))
          } else {
            // New day: create file + day entry via slack:new, inherit tags/rel from previous
            const markdown = `# ${follow.summary}\n\n` + replyParts.join('\n')
            const slackResult = await tasks.run('slack:new', {
              from,
              to,
              summary: follow.summary,
              when: lastActivityAt,
              markdown,
              follow: fileName,
              previous,
              noEditor: true,
              ...(inheritedTags ? { tags: inheritedTags } : {}),
              ...(typeof inheritedRel === 'string' ? { rel: inheritedRel } : {}),
              ...(newReplyFiles.length > 0 ? { slackFiles: JSON.stringify(newReplyFiles) } : {}),
            })

            // Append message path to follow
            const ddfw = new DayDirFileWriter(lastActivityAt.plainDate)
            const relPath = slackResult.ok ? slackResult.data?.filePath : undefined
            if (relPath) {
              const fullTimePath = `time/${ddfw.dayDir}/${relPath}`
              // Stored as a time ref: the follow outlives the layout.
              follow = follow.addMessage(activityDayStr, toTimeRef(fullTimePath))

              // Patch array rel into the created file (slack:new only accepts string params)
              if (Array.isArray(inheritedRel)) {
                const fullPath = path.join(DIR_BASE, fullTimePath)
                const content = await readTextFile(fullPath)
                const doc = MessageDocument.fromMarkdown(content)
                await writeTextFile(
                  fullPath,
                  new MessageDocument({ ...doc.yaml, rel: inheritedRel }, doc.markdown).toMarkdown(),
                )
              }
            }
          }

          output.log(`[check] ${fileName}: ${newReplies.length} new replies`)
          withActivity.push({ fileName, newReplies: newReplies.length })

          // 4a. Update lastChecked + lastActivity, reset checkInterval —
          // lastActivity is the newest reply's real time (the same anchor the
          // capture is dated by), not the check time: a stale reply discovered
          // late must not look like fresh activity
          const checkedAt = (await fetchNow()).plainDateTime
          const newInterval = Follow.backoffInterval(checkedAt, lastActivityAt)
          const updated = follow
            .updateLastActivity(lastActivityAt)
            .updateLastChecked(checkedAt)
            .updateCheckInterval(newInterval)
          await writeTextFile(followPath, updated.toYaml())
        } else {
          output.log(`[check] ${fileName}: no new activity`)

          // 4b. Update lastChecked + backoff checkInterval
          const checkedAt = (await fetchNow()).plainDateTime
          const anchor = follow.lastActivity ?? follow.followSince
          const newInterval = Follow.backoffInterval(checkedAt, anchor)
          const updated = follow.updateLastChecked(checkedAt).updateCheckInterval(newInterval)
          await writeTextFile(followPath, updated.toYaml())
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        output.log(`[check] ${entry.fileName}: ERROR — ${errMsg}`)
        errors.push(`${entry.fileName}: ${errMsg}`)
      }
    }

    if (withActivity.length > 0) {
      output.log('')
      output.log(`Checked ${entries.length} follow(s), ${withActivity.length} with new activity.`)
    }

    return CommandResult.success({ checked: entries.length, expired, skipped, errors, withActivity, channels })
  }
}
