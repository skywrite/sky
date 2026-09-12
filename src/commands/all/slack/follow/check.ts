import { unlink } from 'node:fs/promises'
import * as path from 'node:path'
import { captureMessages } from '#commands/all/slack/lib/captureMessages.ts'
import { checkChannelWatches, type ChannelWatchCheckResult } from '#commands/all/slack/lib/checkChannelWatches.ts'
import { resolveRecipient } from '#commands/all/slack/lib/mod.ts'
import { saveSlackCaptureUpdate } from '#commands/all/slack/lib/saveCapture.ts'
import { syncSlackFollow } from '#commands/all/slack/lib/syncFollow.ts'
import { clearSavedVoiceTranscripts } from '#commands/all/slack/lib/transcribeVoiceMemo.ts'
import { updateSlackCapture } from '#commands/all/slack/lib/updateCapture.ts'
import type { CommandTypesRegistry } from '#commands/lib/core/CommandTypesRegistry.ts'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { DIR_BASE, DIR_STATE_FOLLOW_SLACK_ACTIVE, DIR_STATE_FOLLOW_SLACK_ARCHIVE } from '#config'
import { DayDirFileWriter } from '#lib/nbfs/mod.ts'
import { atomicWrite } from '#lib/outbox/files.ts'
import { exists, outputFile, readTextFile } from '#shared/fs/mod.ts'
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
  /** Follows whose anchors were exported this run (those with a link). */
  polled: number
  /** Polled follows with at least one failed anchor export. */
  exportFailures: number
  /** What the first failed export said, or null when none failed. */
  exportFailure: string | null
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
      return CommandResult.success({
        checked: 0,
        polled: 0,
        exportFailures: 0,
        exportFailure: null,
        expired: [],
        skipped: [],
        errors: [],
        withActivity: [],
        channels,
      })
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
      return CommandResult.success({
        checked: 0,
        polled: 0,
        exportFailures: 0,
        exportFailure: null,
        expired,
        skipped: [],
        errors: [],
        withActivity: [],
        channels,
      })
    }

    const withActivity: CheckSummary[] = []
    const skipped: string[] = []
    const errors: string[] = []
    let polled = 0
    let exportFailures = 0
    let exportFailure: string | null = null

    for (const entry of entries) {
      try {
        let { follow } = entry
        const { path: followPath, fileName } = entry

        const anchors = [follow.ref, ...follow.merged].filter((a) => a.link)
        if (anchors.length === 0) {
          output.log(`[check] ${fileName}: no link in ref, skipping`)
          skipped.push(`${fileName}: no link`)
          continue
        }

        // 1. Poll Slack — one export per anchor (a merged follow watches
        //    several roots and gathers their activity into one stream)
        polled++
        const exports: NonNullable<CommandTypesRegistry['slack:cli:export']['result']>[] = []
        let lastFailure: string | null = null
        for (const anchor of anchors) {
          const exportResult = await tasks.run('slack:cli:export', { link: anchor.link })
          if (!exportResult.ok || !exportResult.data) {
            output.log(`[check] ${fileName}: export failed (${anchor.link}) — ${exportResult.message}`)
            lastFailure = exportResult.message ?? 'no message'
            continue
          }
          exports.push(exportResult.data)
        }
        if (exports.length !== anchors.length) {
          exportFailures++
          exportFailure ??= lastFailure
          skipped.push(`${fileName}: incomplete export — ${lastFailure}`)
          continue
        }
        const data = exports[0]

        const synced = await syncSlackFollow(follow, exports.flatMap(captureMessages), {
          read: async (ref) =>
            MessageDocument.fromMarkdown(await readTextFile(path.join(DIR_BASE, resolveTimeRef(ref)))),
          notebookTime: convertToNotebookTimezone,
          saveFollow: async (pending) => atomicWrite(followPath, pending.toYaml()),
          update: async (ref, doc, messages, day) => {
            const transcriptRuns = new Set<string>()
            const updated = await updateSlackCapture({
              doc,
              messages,
              day,
              output,
              signal: context.signal,
              transcriptRuns,
            })
            if (updated.toMarkdown() !== doc.toMarkdown())
              await saveSlackCaptureUpdate(path.join(DIR_BASE, resolveTimeRef(ref)), doc, updated)
            await clearSavedVoiceTranscripts(transcriptRuns, output)
          },
          create: async ({ messages, when, previous, inherit }) => {
            const from = messages[0].userName || messages[0].userId || '-'
            const inheritedTags = inherit?.yaml['tags']
            const inheritedRel = inherit?.yaml['rel']
            const result = await tasks.run('slack:new', {
              from,
              to: resolveRecipient(data, from),
              summary: follow.summary,
              when,
              slackMessages: JSON.stringify(messages),
              follow: fileName,
              link: data.message.permalink ?? data.link,
              previous: previous ? computePreviousRef(resolveTimeRef(previous), when.plainDate) : undefined,
              noEditor: true,
              ...(typeof inheritedTags === 'string' ? { tags: inheritedTags } : {}),
              ...(typeof inheritedRel === 'string' ? { rel: inheritedRel } : {}),
              ...(Array.isArray(inheritedRel) ? { noAutoRel: true } : {}),
            })
            if (!result.ok || !result.data?.filePath)
              throw new Error(`Failed to save Slack replies: ${result.message ?? 'no file path'}`)
            const ddfw = new DayDirFileWriter(when.plainDate)
            const timePath = `time/${ddfw.dayDir}/${result.data.filePath}`
            if (Array.isArray(inheritedRel)) {
              const fullPath = path.join(DIR_BASE, timePath)
              const doc = MessageDocument.fromMarkdown(await readTextFile(fullPath))
              await atomicWrite(
                fullPath,
                new MessageDocument({ ...doc.yaml, rel: inheritedRel }, doc.markdown).toMarkdown(),
              )
            }
            return toTimeRef(timePath)
          },
        })
        follow = synced.follow
        if (synced.newReplies > 0) {
          output.log(`[check] ${fileName}: ${synced.newReplies} new replies`)
          withActivity.push({ fileName, newReplies: synced.newReplies })
        } else {
          output.log(`[check] ${fileName}: no new activity`)
        }
        // Checkpoint the start of the poll, not its completion: replies can
        // arrive while files are being downloaded or written.
        const checkedAt = (await fetchNow()).plainDateTime
        const activity = synced.lastActivity ?? follow.followSince
        const updated = (synced.lastActivity ? follow.updateLastActivity(synced.lastActivity) : follow)
          .updateLastChecked(nowDt)
          .updateCheckInterval(Follow.backoffInterval(checkedAt, activity))
        await atomicWrite(followPath, updated.toYaml())
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

    return CommandResult.success({
      checked: entries.length,
      polled,
      exportFailures,
      exportFailure,
      expired,
      skipped,
      errors,
      withActivity,
      channels,
    })
  }
}
