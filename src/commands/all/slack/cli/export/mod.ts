import {
  type AgentSlackFile,
  type AgentSlackMessage,
  collectChannelIds,
  collectSubteamIds,
  collectUserIds,
} from '#commands/all/slack/cli/lib/agent-slack/mod.ts'
import { runAgentSlack } from '#commands/all/slack/lib/agentSlack.ts'
import {
  type ConversationType,
  extractWorkspaceUrl,
  formatChannelLabel,
  formatSlackTimestamp,
  inferConversationType,
  normalizeFences,
  resolveContent,
} from '#commands/all/slack/lib/mod.ts'
import {
  resolveChannelInfo,
  resolveChannelNames,
  resolveUsergroupNames,
  resolveUserName,
  resolveUserNames,
} from '#commands/all/slack/lib/resolveNames.ts'
import { slackApiCall } from '#commands/all/slack/lib/slack-api.ts'
import { Arg, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'

const params = {
  link: Arg.string('Slack message link (workspace URL, app URL, or slack:// deeplink)'),
  workspace: Flag.string('Workspace URL (if needed for disambiguation)', { short: 'w' }),
  debug: Flag.bool('Show parsed payload JSON'),
}

type Params = InferParams<typeof params>

type FetchedMessage = {
  ts: string
  timeLabel?: string
  text: string
  userId?: string
  userName?: string
  subtype?: string
  threadTs?: string
  permalink?: string
  files?: AgentSlackFile[]
}

type ThreadReply = {
  ts: string
  timeLabel?: string
  text: string
  userId?: string
  userName?: string
  subtype?: string
  files?: AgentSlackFile[]
}

type ThreadData = {
  threadTs: string
  replies: ThreadReply[]
}

type Result = {
  link: string
  channelId: string
  channelName?: string
  channelMembers?: string[]
  conversationType: ConversationType
  /** The current user's display name — resolved only when a DM's author is its partner */
  selfName?: string
  messageTs: string
  threadTs?: string
  message: FetchedMessage
  thread?: ThreadData
}

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'slack:cli:export': {
      params: Params
      result: Result
    }
  }
}

export default class SlackCliExportTask extends Command {
  static override description: CommandDescription = {
    name: 'slack:cli:export',
    description: 'Follow a Slack message link and print message content using agent-slack CLI.',
    descriptionLong: [
      'Accepts links from workspace URLs, app.slack.com links, and slack:// deep links.',
      'Uses agent-slack CLI to fetch message content and thread replies.',
      'Returns the same Result shape as slack:api:export for interchangeable use.',
    ],
    usage: ['sky slack:cli:export "https://workspace.slack.com/archives/C12345678/p1739447467000000"'],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output, systemNow } = context
    const timezone = systemNow.timezone

    // Fetch the message
    const getArgs = ['message', 'get', args.link, '--max-body-chars', '-1']
    if (args.workspace) {
      getArgs.push('--workspace', args.workspace)
    }

    const getResult = await runAgentSlack(getArgs)
    if (getResult.code !== 0) {
      const detail = getResult.stderr.trim() || getResult.stdout.trim()
      const hint = detail.includes('invalid_auth') ? ' — credentials expired, run `sky slack:auth`' : ''
      return CommandResult.fail(`agent-slack message get failed: ${detail}${hint}`)
    }

    let data: { message: AgentSlackMessage; thread?: { ts: string; length: number } }
    try {
      data = JSON.parse(getResult.stdout)
    } catch {
      return CommandResult.fail(`Failed to parse agent-slack output: ${getResult.stdout}`)
    }

    // Collect all messages (root + thread replies)
    const allAgentMessages: AgentSlackMessage[] = [data.message]
    let agentThreadMessages: AgentSlackMessage[] = []

    if (data.thread) {
      const listArgs = ['message', 'list', args.link, '--thread-ts', data.thread.ts, '--max-body-chars', '-1']
      if (args.workspace) {
        listArgs.push('--workspace', args.workspace)
      }

      const listResult = await runAgentSlack(listArgs)
      if (listResult.code === 0) {
        try {
          const threadData: { messages?: AgentSlackMessage[] } = JSON.parse(listResult.stdout)
          const allReplies = threadData.messages ?? []
          agentThreadMessages = allReplies.filter((m) => m.ts !== data.message.ts)
          allAgentMessages.push(...agentThreadMessages)
        } catch {
          output.log(`Failed to parse thread output: ${listResult.stdout}`)
        }
      } else {
        output.log(`Failed to fetch thread: ${listResult.stderr}`)
      }
    }

    // Resolve all user IDs (the users.info fallback needs the workspace URL)
    const workspaceUrl = extractWorkspaceUrl(args.link)
    const userIds = collectUserIds(allAgentMessages)
    const userNames = await resolveUserNames(userIds, workspaceUrl)

    // Resolve channel info (name + actual conversation type from API)
    const channelId = data.message.channel_id
    let conversationType = inferConversationType(channelId)
    let channelName: string | undefined

    let channelMembers: string[] | undefined

    if (workspaceUrl) {
      const info = await resolveChannelInfo(channelId, userNames, workspaceUrl)
      channelName = info.name
      channelMembers = info.members
      if (info.detectedType) conversationType = info.detectedType
    }

    // Resolve channels (<#C…>) and usergroups (<!subteam^S…>) mentioned in message text
    const channelNames = workspaceUrl
      ? await resolveChannelNames(collectChannelIds(allAgentMessages), userNames, workspaceUrl)
      : new Map<string, string>()
    const usergroupNames = workspaceUrl
      ? await resolveUsergroupNames(collectSubteamIds(allAgentMessages), workspaceUrl)
      : new Map<string, string>()

    // An unanswered DM has the current user's name nowhere in its messages —
    // resolveRecipient needs it, so fetch it exactly when a DM's author is its
    // partner (heartbeat polls of ordinary DMs pay nothing)
    let selfName: string | undefined
    const authorName = data.message.author?.user_id ? userNames.get(data.message.author.user_id) : undefined
    if (workspaceUrl && conversationType === 'dm' && authorName && channelMembers?.[0] === authorName) {
      selfName = await resolveSelfName(userNames, workspaceUrl)
    }

    // Resolve permalink
    const permalink = workspaceUrl ? await resolvePermalink(channelId, data.message.ts, workspaceUrl) : undefined

    // Build Result in same shape as slack:api:export
    const message: FetchedMessage = {
      ts: data.message.ts,
      timeLabel: formatSlackTimestamp(data.message.ts, timezone),
      text: normalizeFences(resolveContent(data.message.content || '', userNames, channelNames, usergroupNames)),
      userId: data.message.author?.user_id,
      userName: data.message.author?.user_id ? userNames.get(data.message.author.user_id) : undefined,
      threadTs: data.message.thread_ts,
      permalink,
      files: data.message.files,
    }

    let thread: ThreadData | undefined
    if (agentThreadMessages.length > 0) {
      const threadTs = data.thread?.ts ?? data.message.thread_ts ?? data.message.ts
      thread = {
        threadTs,
        replies: agentThreadMessages.map(
          (m): ThreadReply => ({
            ts: m.ts,
            timeLabel: formatSlackTimestamp(m.ts, timezone),
            text: normalizeFences(resolveContent(m.content || '', userNames, channelNames, usergroupNames)),
            userId: m.author?.user_id,
            userName: m.author?.user_id ? userNames.get(m.author.user_id) : undefined,
            files: m.files,
          }),
        ),
      }
    }

    const result: Result = {
      link: args.link,
      channelId,
      channelName,
      channelMembers,
      conversationType,
      selfName,
      messageTs: data.message.ts,
      threadTs: data.message.thread_ts,
      message,
      thread,
    }

    // Output — matches slack:api:export format
    output.log('')
    output.log('Slack Markdown')
    output.log('')
    output.log(`Channel: ${formatChannelLabel(channelId, conversationType, channelName)}`)
    output.log(`Message TS: ${result.messageTs}`)
    output.log(`Time zone: ${timezone}`)
    if (result.threadTs) {
      output.log(`Thread TS: ${result.threadTs}`)
    }
    output.log('')
    outputMessageBlock(output, result.message)

    if (result.message.permalink) {
      output.log(`Permalink: ${result.message.permalink}`)
      output.log('')
    }

    if (result.thread) {
      output.log(`Thread replies: ${result.thread.replies.length}`)
      output.log('')
      if (result.thread.replies.length === 0) {
        output.log('  (none)')
        output.log('')
        output.log('')
      } else {
        for (const reply of result.thread.replies) {
          outputMessageBlock(output, reply)
        }
      }
    }

    if (args.debug) {
      output.log('')
      output.log('Parsed payload:')
      output.log(JSON.stringify(result, null, 2))
    }

    return CommandResult.success(result)
  }
}

// =============================================================================
// Export-specific lookups (name resolution itself lives in lib/resolveNames.ts)
// =============================================================================

/** The current user's display name via auth.test on the keychain creds. */
async function resolveSelfName(userNames: Map<string, string>, workspaceUrl: string): Promise<string | undefined> {
  const json = await slackApiCall(workspaceUrl, 'auth.test', {})
  const selfId = json?.user_id as string | undefined
  if (!selfId) return undefined
  return resolveUserName(selfId, userNames, workspaceUrl)
}

async function resolvePermalink(
  channelId: string,
  messageTs: string,
  workspaceUrl: string,
): Promise<string | undefined> {
  const json = await slackApiCall(workspaceUrl, 'chat.getPermalink', {
    channel: channelId,
    message_ts: messageTs,
  })
  return json?.permalink as string | undefined
}

// =============================================================================
// Output
// =============================================================================

function formatUserLabel(userId?: string, userName?: string): string {
  if (userName) return userName
  return userId || '-'
}

function outputMessageBlock(
  output: { log: (message: string) => void },
  message: { ts: string; timeLabel?: string; text: string; userId?: string; userName?: string; subtype?: string },
): void {
  output.log(`**${formatUserLabel(message.userId, message.userName)}** ${message.timeLabel || message.ts}`)
  output.log('')
  if (message.subtype) {
    output.log(`[${message.subtype}]`)
  }
  output.log(message.text || '(empty message text)')
  output.log('')
  output.log('')
  output.log('')
}
