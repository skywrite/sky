import { unlink } from 'node:fs/promises'
import * as path from 'node:path'
import { checkChannelWatches, type ChannelWatchCheckResult } from '#commands/all/slack/lib/checkChannelWatches.ts'
import { followAnchors, pollSlackFollow } from '#commands/all/slack/lib/pollFollow.ts'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { DIR_STATE_FOLLOW_SLACK_ACTIVE, DIR_STATE_FOLLOW_SLACK_ARCHIVE } from '#config'
import { exists, outputFile } from '#shared/fs/mod.ts'
import Follow from '#shared/models/Follow/mod.ts'
import SlackFollowRegistry from '#shared/models/Follow/SlackFollowRegistry.ts'
import { fetchNowSync } from '#shared/nbfs/mod.ts'

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
        const { fileName } = entry

        if (followAnchors(entry.follow).length === 0) {
          output.log(`[check] ${fileName}: no link in ref, skipping`)
          skipped.push(`${fileName}: no link`)
          continue
        }

        polled++
        const poll = await pollSlackFollow(entry, { tasks, output, signal: context.signal, now: nowDt })
        if (!poll.ok) {
          for (const failure of poll.failures) {
            output.log(`[check] ${fileName}: export failed (${failure.link}) — ${failure.message}`)
          }
          const lastFailure = poll.failures.at(-1)?.message ?? null
          exportFailures++
          exportFailure ??= lastFailure
          skipped.push(`${fileName}: incomplete export — ${lastFailure}`)
          continue
        }
        if (poll.newReplies > 0) {
          output.log(`[check] ${fileName}: ${poll.newReplies} new replies`)
          withActivity.push({ fileName, newReplies: poll.newReplies })
        } else {
          output.log(`[check] ${fileName}: no new activity`)
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
