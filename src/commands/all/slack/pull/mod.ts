import * as path from 'node:path'
import { fetchDmMembership, resolveChannelInfo } from '#commands/all/slack/lib/resolveNames.ts'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import {
  DIR_STATE,
  DIR_STATE_SLACK_DAYS,
  FILE_STATE_SLACK_CHANNELS,
  FILE_STATE_SLACK_RULES,
  SLACK_WORKSPACE,
} from '#config'
import { withProcessLock } from '#lib/jobs/files.ts'
import { Instant, instantNow } from '#universal/dates/nbdt/mod.ts'
import { appendChannelDay, channelDayPath, channelFileName } from './lib/cache.ts'
import { createClock } from './lib/clock.ts'
import { createNameResolver } from './lib/names.ts'
import { PULL_DEFAULTS, pullChannels, type PullHost, type PullResult } from './lib/pull.ts'
import { readRoster, writeRoster, type Roster } from './lib/roster.ts'
import { readRules } from './lib/rules.ts'
import { listChannelHistory, listJoinedConversations, listThread } from './lib/slack.ts'

const params = {
  channel: Flag.string('Only this channel: #name or conversation id', { optional: true }),
  max: Flag.number('Stop after this many channels, most recently active first'),
  backfillDays: Flag.number("Days of history a channel's first read goes back", {
    default: PULL_DEFAULTS.backfillDays,
  }),
}

type Params = InferParams<typeof params>

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'slack:pull': { params: Params; result: PullResult }
  }
}

export default class SlackPullTask extends Command {
  static override description: CommandDescription = {
    name: 'slack:pull',
    description: 'Pull every new message from every Slack channel you are in into the channel cache.',
    descriptionLong: [
      'Reads each joined channel since the last pull and writes the messages,',
      'thread replies included, to the channel cache: one file per channel',
      'and UTC day under the state area (state/slack/days/<day>/<channel>.md).',
      'Each message heads with its notebook time, the day open at that moment',
      'the way captures file, and carries the system and UTC clocks beneath;',
      'people, channels and groups are named rather than listed by id. Each',
      'reply links the root of its thread, so a whole thread can be read back',
      'from the cache alone, and sky recap:slack reads a notebook day of it.',
      'Nothing is written into the notebook itself.',
      '',
      'The first read of a channel goes --backfill-days back (default 7). Sky',
      'keeps its own cursor per channel in state/slack/channels.yaml; reading',
      'Slack never marks anything read there. A pull costs one call to find',
      'which channels have anything new, then a history read only for those,',
      'plus one read per thread with new replies. Every read re-reads the last',
      'two days of a channel to notice replies in older threads, and once a',
      'day the whole backfill window. Replies to threads older than that are',
      'not noticed. Joins, leaves and topic changes are left out. Direct',
      'messages and group messages are not channels and are not pulled. A',
      'channel switched off under Settings › Connections › Slack is left out.',
      '',
      '--channel pulls one channel; --max stops after that many channels,',
      'most recently active first. The service runs a pull every five',
      'minutes; only one runs at a time, and one started while another is',
      'running says so and stops.',
    ],
    usage: [
      'sky slack:pull',
      'sky slack:pull --channel atlas',
      'sky slack:pull --max 20',
      'sky slack:pull --backfill-days 30',
    ],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<PullResult>> {
    const { output, systemNow } = context
    const workspace = SLACK_WORKSPACE
    if (!workspace) {
      return CommandResult.fail(
        'No Slack workspace is configured: set slack.workspace in ~/.sky/config.jsonc, then run sky slack:auth.',
      )
    }
    if (args.backfillDays < 1) return CommandResult.fail('--backfill-days must be at least 1.')
    if (args.max !== undefined && args.max < 1) return CommandResult.fail('--max must be at least 1.')

    const now = Math.floor(Instant.from(instantNow()).epochMilliseconds / 1000)
    const resolver = createNameResolver(workspace)
    const { names } = resolver
    let roster: Roster = { channels: [], runs: [] }

    const host: PullHost = {
      now,
      timezone: systemNow.timezone,
      clock: createClock({ timezone: systemNow.timezone }),
      log: (line) => output.log(line),
      signal: context.signal,
      counts: () => listJoinedConversations(workspace),
      channelNames: async (ids) => {
        // One client boot call names every joined channel; conversations.info covers any it leaves out
        const found = new Map<string, string>()
        const boot = await fetchDmMembership(workspace)
        for (const id of ids) {
          const name = boot.conversations?.get(id)?.name
          if (name) found.set(id, name)
        }
        for (const id of ids.filter((id) => !found.has(id))) {
          const info = await resolveChannelInfo(id, names.users, workspace)
          if (info.name) found.set(id, info.name)
        }
        return found
      },
      history: (channelId, oldest) => listChannelHistory(workspace, channelId, oldest),
      thread: (channelId, threadTs) => listThread(workspace, channelId, threadTs),
      names: resolver.resolve,
      readRoster: async () => {
        roster = await readRoster(FILE_STATE_SLACK_CHANNELS)
        // Channel mentions mostly point at joined channels, whose names the roster already holds
        for (const channel of roster.channels) names.channels.set(channel.id, channel.name)
        return roster
      },
      writeRoster: (updated) => writeRoster(FILE_STATE_SLACK_CHANNELS, updated),
      readRules: () => readRules(FILE_STATE_SLACK_RULES),
      append: (channel, day, entries) =>
        appendChannelDay(
          channelDayPath(DIR_STATE_SLACK_DAYS, day, channelFileName(channel, roster.channels)),
          { channel: channel.name, channelId: channel.id, workspace, day },
          entries,
        ),
    }

    const result = await withProcessLock(path.join(DIR_STATE, 'slack', 'pull-lock'), () =>
      pullChannels(host, { ...PULL_DEFAULTS, backfillDays: args.backfillDays, only: args.channel, max: args.max }),
    )
    if (!result) return CommandResult.fail('Another Slack pull is running. Try again in a moment.')
    if (args.channel && result.pulled.length === 0 && result.unchanged === 0 && result.errors.length === 0) {
      return CommandResult.fail(
        result.muted > 0
          ? `${args.channel} is muted: nothing from it is kept. Switch it on under Settings › Connections › Slack.`
          : `No joined channel matches ${args.channel}. Names match exactly, with or without #; ids work too.`,
      )
    }

    const added = result.pulled.reduce((sum, channel) => sum + channel.added, 0)
    const withNew = result.pulled.filter((channel) => channel.added > 0).length
    const checked = result.pulled.length
    output.log('')
    const mutedNote = result.muted > 0 ? `, ${result.muted} muted` : ''
    output.log(
      `${added} new message(s) in ${withNew} channel(s); ${checked} channel(s) read, ${result.unchanged} unchanged${mutedNote}, ${result.joined} joined.`,
    )
    if (result.errors.length > 0) {
      output.log(`${result.errors.length} channel(s) failed and keep their cursor; the next pull retries them.`)
    }
    return CommandResult.success(result)
  }
}
