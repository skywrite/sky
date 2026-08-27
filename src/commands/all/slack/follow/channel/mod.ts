import * as path from 'node:path'
import { parseAuthTest } from '#commands/all/slack/cli/lib/agent-slack/mod.ts'
import type { AgentSlackMessage } from '#commands/all/slack/cli/lib/agent-slack/types.ts'
import { runAgentSlack } from '#commands/all/slack/lib/agentSlack.ts'
import parseChannelTarget from '#commands/all/slack/lib/parseChannelTarget.ts'
import { Arg, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { DIR_STATE_FOLLOW_SLACK_CHANNELS, SLACK_WORKSPACE } from '#config'
import slugify from '#lib/string/slugify.ts'
import { outputFile } from '#shared/fs/mod.ts'
import ChannelWatch, { ChannelWatchRegistry } from '#shared/models/Follow/ChannelWatch.ts'
import { fetchNowSync } from '#shared/nbfs/mod.ts'

const params = {
  target: Arg.string('Channel to watch: channel URL (https://ws.slack.com/archives/C…), #name, or channel id'),
  interval: Flag.string(`Check interval (default ${ChannelWatch.DEFAULT_INTERVAL})`, {
    short: 'i',
    default: () => ChannelWatch.DEFAULT_INTERVAL,
  }),
  workspace: Flag.string(
    'Workspace URL or selector for #name/id targets — defaults to slack.workspace from the sky config',
  ),
}

type Params = InferParams<typeof params>
type Result = {
  /** Watch YAML path */
  file?: string
  watching: boolean
}

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'slack:follow:channel': {
      params: Params
      result: Result
    }
  }
}

/**
 * The workspace URL for a #name/id target: an explicit --workspace or the
 * config's slack.workspace. Either may be a substring selector rather than a
 * URL — agent-slack's auth test resolves it to the canonical workspace URL,
 * which the watch stores for building archive links.
 */
async function resolveWorkspaceUrl(explicit?: string): Promise<string | undefined> {
  const candidate = explicit?.trim() || SLACK_WORKSPACE
  if (!candidate) return undefined
  if (/^https:\/\//.test(candidate)) return candidate.replace(/\/+$/, '')
  const result = await runAgentSlack(['auth', 'test', '--workspace', candidate])
  const status = parseAuthTest(result.stdout, result.stderr)
  return status.ok && status.url ? status.url.replace(/\/+$/, '') : undefined
}

export default class SlackFollowChannelTask extends Command {
  static override description: CommandDescription = {
    name: 'slack:follow:channel',
    description: 'Permanently watch a Slack channel — every new root message is captured as a follow.',
    descriptionLong: [
      'Writes a channel-watch record with a message-ts cursor. On each',
      'slack:follow:check pass, root messages newer than the cursor run through',
      'slack:follow:message: the thread is captured into the notebook and',
      'followed for replies; threads already in the follow ledger are declined',
      'by its dedup, so the watch composes with hand and Later captures.',
      '',
      'The watch never expires on its own — close it with',
      'slack:follow:channel:close, list watches with slack:follow:channel:list.',
    ],
    usage: [
      'sky slack:follow:channel "https://workspace.slack.com/archives/C01234ABCDE"',
      'sky slack:follow:channel "#releases" --workspace https://workspace.slack.com',
      'sky slack:follow:channel C01234ABCDE --workspace https://workspace.slack.com --interval 1h',
    ],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context

    const parsed = parseChannelTarget(args.target)
    if (!parsed) {
      return CommandResult.fail(`Not a channel target: "${args.target}" (channel URL, #name, or channel id)`)
    }

    const workspaceUrl = parsed.workspaceUrl ?? (await resolveWorkspaceUrl(args.workspace))
    if (!workspaceUrl) {
      return CommandResult.fail(
        'Workspace unknown — set slack.workspace in the sky config, pass --workspace, or use a channel URL',
      )
    }

    // One history probe: verifies access, resolves #name → channel id, and
    // anchors the cursor at the newest existing message so the watch captures
    // only what arrives after it.
    const probeTarget = parsed.channelId ?? `#${parsed.channelName}`
    const probe = await runAgentSlack([
      'message',
      'list',
      probeTarget,
      '--workspace',
      workspaceUrl,
      '--limit',
      '1',
      '--max-body-chars',
      '1',
    ])
    if (probe.code !== 0) {
      const detail = probe.stderr.trim() || probe.stdout.trim()
      const hint = detail.includes('invalid_auth') ? ' — credentials expired, run `sky slack:auth`' : ''
      return CommandResult.fail(`Cannot read ${probeTarget}: ${detail}${hint}`)
    }

    let channelId: string
    let newestTs: string | undefined
    try {
      const data = JSON.parse(probe.stdout) as { channel_id?: string; messages?: AgentSlackMessage[] }
      channelId = data.channel_id ?? data.messages?.at(-1)?.channel_id ?? parsed.channelId ?? ''
      newestTs = data.messages?.at(-1)?.ts
    } catch {
      return CommandResult.fail(`Unparseable agent-slack output for ${probeTarget}`)
    }
    if (!channelId) {
      return CommandResult.fail(`Could not resolve a channel id for ${probeTarget}`)
    }

    const registry = await ChannelWatchRegistry.build(DIR_STATE_FOLLOW_SLACK_CHANNELS)
    const existing = registry.findByChannel(channelId)
    if (existing) {
      output.log(`Already watching: ${existing.watch.label} (${existing.fileName})`)
      return CommandResult.fail(`Duplicate channel watch: ${existing.fileName}`)
    }

    const now = fetchNowSync().plainDateTime
    const label = parsed.channelName ?? channelId
    const watch = ChannelWatch.create({
      channel: channelId,
      workspaceUrl,
      label,
      checkInterval: args.interval,
      watchSince: now,
      lastChecked: now,
      // An empty channel starts from the beginning of time — there is nothing
      // behind the cursor to backfill anyway.
      lastSeenTs: newestTs ?? '0.000000',
    })

    const fileName =
      label === channelId ? `${channelId}.yaml` : `${slugify(label, { preserveCase: true })}_${channelId}.yaml`
    const filePath = path.join(DIR_STATE_FOLLOW_SLACK_CHANNELS, fileName)
    await outputFile(filePath, watch.toYaml())

    output.log('')
    output.log(`Watching channel: ${label}`)
    output.log(`  Channel:  ${channelId}`)
    output.log(`  Interval: ${args.interval}`)
    output.log(`  Cursor:   ${watch.lastSeenTs} (captures start after this)`)
    output.log(`  Watch:    ${filePath}`)
    output.log('')

    return CommandResult.success({ file: filePath, watching: true })
  }
}
