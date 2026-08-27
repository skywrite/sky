import { unlink } from 'node:fs/promises'
import parseChannelTarget from '#commands/all/slack/lib/parseChannelTarget.ts'
import { Arg, Command, CommandResult } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { DIR_STATE_FOLLOW_SLACK_CHANNELS } from '#config'
import { ChannelWatchRegistry } from '#shared/models/Follow/ChannelWatch.ts'

const params = {
  target: Arg.string('Watch to close: channel URL, #name, channel id, or the watch file name'),
}

type Params = InferParams<typeof params>
type Result = { closed: boolean; file?: string }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'slack:follow:channel:close': {
      params: Params
      result: Result
    }
  }
}

export default class SlackFollowChannelCloseTask extends Command {
  static override description: CommandDescription = {
    name: 'slack:follow:channel:close',
    description: 'Stop watching a channel (captured follows and docs stay).',
    descriptionLong: [
      'Deletes the channel-watch record — the cursor is all it holds, so there',
      'is nothing to archive. Follows the watch spawned stay active, and every',
      'captured doc stays in the notebook.',
    ],
    usage: ['sky slack:follow:channel:close "#releases"', 'sky slack:follow:channel:close C01234ABCDE'],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context
    const registry = await ChannelWatchRegistry.build(DIR_STATE_FOLLOW_SLACK_CHANNELS)
    if (registry.size === 0) {
      return CommandResult.fail('No channel watches.')
    }

    const parsed = parseChannelTarget(args.target)
    const needle = args.target.trim().replace(/\.ya?ml$/, '')
    const entry = registry.getAll().find(({ watch, fileName }) => {
      if (parsed?.channelId && watch.channel === parsed.channelId) return true
      if (parsed?.channelName && watch.label === parsed.channelName) return true
      return fileName === needle || watch.label === needle
    })

    if (!entry) {
      const known = registry
        .getAll()
        .map((e) => e.watch.label)
        .join(', ')
      return CommandResult.fail(`No watch matches "${args.target}" (watching: ${known})`)
    }

    await unlink(entry.path)
    output.log(`Stopped watching ${entry.watch.label} (${entry.watch.channel}) — ${entry.fileName} deleted.`)
    output.log('Follows and docs it captured stay as they are.')
    return CommandResult.success({ closed: true, file: entry.path })
  }
}
