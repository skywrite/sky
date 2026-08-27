import formatSlackTimestamp from '#commands/all/slack/lib/formatSlackTimestamp.ts'
import { Command, CommandResult } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { DIR_STATE_FOLLOW_SLACK_CHANNELS } from '#config'
import { ChannelWatchRegistry } from '#shared/models/Follow/ChannelWatch.ts'

const params = {}

type Params = InferParams<typeof params>
type WatchRow = { fileName: string; channel: string; label: string; interval: string; status: string }
type Result = { watches: WatchRow[] }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'slack:follow:channel:list': {
      params: Params
      result: Result
    }
  }
}

export default class SlackFollowChannelListTask extends Command {
  static override description: CommandDescription = {
    name: 'slack:follow:channel:list',
    description: 'List watched Slack channels.',
    usage: ['sky slack:follow:channel:list'],
    params,
  }

  async run({ context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output, systemNow } = context
    const registry = await ChannelWatchRegistry.build(DIR_STATE_FOLLOW_SLACK_CHANNELS)
    const entries = registry.getAll()

    if (entries.length === 0) {
      output.log('No channel watches.')
      return CommandResult.success({ watches: [] })
    }

    for (const { watch, fileName } of entries) {
      const cursorLabel =
        watch.lastSeenTs === '0.000000' ? 'start' : formatSlackTimestamp(watch.lastSeenTs, systemNow.timezone)
      const checked = watch.lastChecked ? `${watch.lastChecked.date} ${watch.lastChecked.time}` : 'never'
      const paused = watch.status === 'active' ? '' : `  [${watch.status}]`
      output.log(`${watch.label}  (${watch.channel})  every ${watch.checkInterval}${paused}`)
      output.log(`  seen through ${cursorLabel} · last checked ${checked} · ${fileName}`)
    }

    return CommandResult.success({
      watches: entries.map(({ watch, fileName }) => ({
        fileName,
        channel: watch.channel,
        label: watch.label,
        interval: watch.checkInterval,
        status: watch.status,
      })),
    })
  }
}
