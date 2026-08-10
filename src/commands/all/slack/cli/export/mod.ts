import {
  type AgentSlackFile,
  type AgentSlackMessage,
  type AgentSlackUser,
  collectUserIds,
  parseUser,
} from '#commands/all/slack/cli/lib/agent-slack/mod.ts'
import { runAgentSlack } from '#commands/all/slack/lib/agentSlack.ts'
import {
  type ConversationType,
  extractWorkspaceUrl,
  formatChannelLabel,
  formatNameList,
  formatSlackTimestamp,
  inferConversationType,
  resolveContent,
} from '#commands/all/slack/lib/mod.ts'
import { mpdmMemberHandles } from '#commands/all/slack/lib/mpdmMembers.ts'
import { Arg, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { runCommand } from '#lib/sys/mod.ts'

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

    // Resolve all user IDs
    const userIds = collectUserIds(allAgentMessages)
    const userNames = await resolveUserNames(userIds)

    // Resolve channel info (name + actual conversation type from API)
    const channelId = data.message.channel_id
    let conversationType = inferConversationType(channelId)
    const workspaceUrl = extractWorkspaceUrl(args.link)
    let channelName: string | undefined

    let channelMembers: string[] | undefined

    if (workspaceUrl) {
      const info = await resolveChannelInfo(channelId, userNames, workspaceUrl)
      channelName = info.name
      channelMembers = info.members
      if (info.detectedType) conversationType = info.detectedType
    }

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
      text: resolveContent(data.message.content || '', userNames),
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
            text: resolveContent(m.content || '', userNames),
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
// User resolution (calls agent-slack CLI)
// =============================================================================

async function resolveUserNames(userIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  await Promise.all(
    userIds.map(async (id) => {
      const result = await runAgentSlack(['user', 'get', id])
      if (result.code === 0) {
        try {
          const user: AgentSlackUser = JSON.parse(result.stdout)
          const name = parseUser(user)
          if (name) map.set(id, name)
        } catch {
          /* skip */
        }
      }
    }),
  )
  return map
}

async function resolveUserName(
  userId: string,
  userNames: Map<string, string>,
  workspaceUrl?: string,
): Promise<string | undefined> {
  let name = userNames.get(userId)
  if (name) return name
  let hasFullName = false
  const result = await runAgentSlack(['user', 'get', userId])
  if (result.code === 0) {
    try {
      const user: AgentSlackUser = JSON.parse(result.stdout)
      hasFullName = !!(user.real_name || user.display_name)
      name = parseUser(user)
      if (name) userNames.set(userId, name)
    } catch {
      /* skip */
    }
  }
  // Fallback to Slack API when agent-slack has no full name (Connect users)
  if (!hasFullName && workspaceUrl) {
    const json = await slackApiCall(workspaceUrl, 'users.info', { user: userId })
    if (json) {
      const user = json.user as Record<string, unknown> | undefined
      const profile = user?.profile as Record<string, string> | undefined
      const fullName = (user?.real_name as string) || profile?.real_name || profile?.display_name
      if (fullName) {
        name = fullName
        userNames.set(userId, name)
      }
    }
  }
  return name
}

// =============================================================================
// Channel resolution (reads agent-slack credentials from Keychain)
// =============================================================================

async function getSlackCredentials(workspaceUrl: string): Promise<{ token: string; cookie: string } | undefined> {
  const [tokenResult, cookieResult] = await Promise.all([
    runCommand('security', ['find-generic-password', '-s', 'agent-slack', '-a', `xoxc:${workspaceUrl}`, '-w']),
    runCommand('security', ['find-generic-password', '-s', 'agent-slack', '-a', 'xoxd', '-w']),
  ])
  if (tokenResult.code !== 0 || cookieResult.code !== 0) return undefined
  return { token: tokenResult.stdout.trim(), cookie: cookieResult.stdout.trim() }
}

async function slackApiCall(
  workspaceUrl: string,
  method: string,
  params: Record<string, string>,
): Promise<Record<string, unknown> | undefined> {
  const creds = await getSlackCredentials(workspaceUrl)
  if (!creds) return undefined

  const formBody = new URLSearchParams({ token: creds.token, ...params })
  try {
    const response = await fetch(`${workspaceUrl}/api/${method}`, {
      method: 'POST',
      headers: {
        Cookie: `d=${encodeURIComponent(creds.cookie)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formBody,
    })
    const json = (await response.json()) as Record<string, unknown>
    return json.ok ? json : undefined
  } catch {
    return undefined
  }
}

type ChannelInfo = { name?: string; members?: string[]; detectedType?: ConversationType }

async function resolveChannelInfo(
  channelId: string,
  userNames: Map<string, string>,
  workspaceUrl: string,
): Promise<ChannelInfo> {
  const json = await slackApiCall(workspaceUrl, 'conversations.info', { channel: channelId })
  if (!json) return {}

  const channel = json.channel as Record<string, unknown> | undefined
  if (!channel) return {}

  // Use API flags to detect actual conversation type (ID prefix is unreliable)
  if (channel.is_im === true) {
    const dmUserId = channel.user as string | undefined
    if (dmUserId) {
      const userName = await resolveUserName(dmUserId, userNames, workspaceUrl)
      if (userName) return { name: `DM with ${userName}`, members: [userName], detectedType: 'dm' }
    }
    return { detectedType: 'dm' }
  }

  if (channel.is_mpim === true) {
    let memberNames = await resolveGroupDmMembers(channelId, userNames, workspaceUrl)
    if (memberNames.length === 0) {
      // Enterprise Grid blocks conversations.members (enterprise_is_restricted) —
      // fall back to the member handles encoded in the mpdm channel name itself
      memberNames = await resolveMpdmSlugMembers(channel.name as string | undefined)
    }
    const name = memberNames.length > 0 ? `DM with ${formatNameList(memberNames)}` : undefined
    return { name, members: memberNames.length > 0 ? memberNames : undefined, detectedType: 'group' }
  }

  // Regular channel — use the name field
  const name = channel.name as string | undefined
  return { name, detectedType: 'channel' }
}

/** The current user's display name via auth.test on the keychain creds. */
async function resolveSelfName(userNames: Map<string, string>, workspaceUrl: string): Promise<string | undefined> {
  const json = await slackApiCall(workspaceUrl, 'auth.test', {})
  const selfId = json?.user_id as string | undefined
  if (!selfId) return undefined
  return resolveUserName(selfId, userNames, workspaceUrl)
}

/** Resolve mpdm slug handles ("bob.smith") to display names via agent-slack; the handle itself is the fallback. */
async function resolveMpdmSlugMembers(channelName: string | undefined): Promise<string[]> {
  const names: string[] = []
  for (const handle of mpdmMemberHandles(channelName)) {
    const result = await runAgentSlack(['user', 'get', handle])
    let resolved: string | undefined
    if (result.code === 0) {
      try {
        resolved = parseUser(JSON.parse(result.stdout) as AgentSlackUser)
      } catch {
        /* fall through to the handle */
      }
    }
    names.push(resolved || handle)
  }
  return names
}

async function resolveGroupDmMembers(
  channelId: string,
  userNames: Map<string, string>,
  workspaceUrl: string,
): Promise<string[]> {
  const membersJson = await slackApiCall(workspaceUrl, 'conversations.members', { channel: channelId })
  if (!membersJson) return []

  const memberIds = membersJson.members as string[] | undefined
  if (!memberIds || memberIds.length === 0) return []

  const names: string[] = []
  for (const id of memberIds) {
    const name = await resolveUserName(id, userNames, workspaceUrl)
    if (name) names.push(name)
  }

  return names
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
