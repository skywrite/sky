import { WebClient } from '@slack/web-api'
import normalizeFences from '#commands/all/slack/lib/normalizeFences.ts'
import { Arg, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'

const params = {
  link: Arg.string('Slack message link (workspace URL, app URL, or slack:// deeplink)'),
  token: Flag.string('Slack user token (or set SLACK_USER_TOKEN env var)', { short: 't' }),
  debug: Flag.bool('Show parsed payload JSON'),
}

type Params = InferParams<typeof params>
type LinkType = 'workspace' | 'app' | 'deeplink'
type ConversationType = 'channel' | 'dm' | 'group' | 'unknown'

type FetchedMessage = {
  ts: string
  timeLabel?: string
  text: string
  userId?: string
  userName?: string
  subtype?: string
  threadTs?: string
  permalink?: string
}

type ThreadReply = {
  ts: string
  timeLabel?: string
  text: string
  userId?: string
  userName?: string
  subtype?: string
}

type ThreadData = {
  threadTs: string
  replies: ThreadReply[]
}

type Result = {
  link: string
  linkType: LinkType
  teamId?: string
  channelId: string
  channelName?: string
  channelMembers?: string[]
  conversationType: ConversationType
  messageTs: string
  threadTs?: string
  message: FetchedMessage
  thread?: ThreadData
}

type ParsedSlackLink = {
  link: string
  linkType: LinkType
  teamId?: string
  channelId?: string
  messageTs?: string
  threadTs?: string
}

type ResolveUserName = (userId?: string) => Promise<string | undefined>

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'slack:api:export': {
      params: Params
      result: Result
    }
  }
}

export default class SlackApiExportTask extends Command {
  static override description: CommandDescription = {
    name: 'slack:api:export',
    description: 'Follow a Slack message link and print message content to console.',
    descriptionLong: [
      'Accepts links from workspace URLs, app.slack.com links, and slack:// deep links.',
      'Normalizes channel + timestamp from the link, fetches the message via conversations.history,',
      'and fetches thread replies via conversations.replies when thread_ts exists.',
    ],
    usage: [
      'sky slack:api:export "https://workspace.slack.com/archives/C12345678/p1739447467000000"',
      'sky slack:api:export "https://app.slack.com/client/T12345678/D12345678/p1739447467000000"',
      'sky slack:api:export "slack://channel?team=T12345678&id=C12345678&message=1739447467.000000"',
    ],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output, env, systemNow } = context
    const token = args.token || env.SLACK_USER_TOKEN
    const timezone = systemNow.timezone

    if (!token) {
      return CommandResult.fail(
        'No Slack token provided. Use --token flag or set SLACK_USER_TOKEN environment variable.',
      )
    }

    const parseResult = parseSlackMessageLink(args.link)

    if (!parseResult.parsed) {
      return CommandResult.fail(parseResult.error || 'Unable to parse Slack link.')
    }

    const parsed = parseResult.parsed
    if (!parsed.channelId) {
      return CommandResult.fail('Could not extract channel ID from Slack link.')
    }
    if (!parsed.messageTs) {
      return CommandResult.fail('Could not extract message timestamp from Slack link.')
    }

    const client = new WebClient(token)
    const resolveUserName = createUserNameResolver(client)
    let conversationType = inferConversationType(parsed.channelId)
    const channelInfo = await resolveChannelInfo(client, parsed.channelId, resolveUserName)
    const channelName = channelInfo.name
    const channelMembers = channelInfo.members
    if (channelInfo.detectedType) conversationType = channelInfo.detectedType
    let message: FetchedMessage
    let thread: ThreadData | undefined
    try {
      message = await fetchMessageByCoordinates(client, parsed.channelId, parsed.messageTs, timezone, resolveUserName)
      const threadTsToFetch = message.threadTs || parsed.threadTs
      if (threadTsToFetch) {
        thread = await fetchThreadReplies(client, parsed.channelId, threadTsToFetch, timezone, resolveUserName)
      }
    } catch (error) {
      return CommandResult.error(error as Error, 'Failed to fetch Slack message from link coordinates')
    }

    const result: Result = {
      link: parsed.link,
      linkType: parsed.linkType,
      teamId: parsed.teamId,
      channelId: parsed.channelId,
      channelName,
      channelMembers,
      conversationType,
      messageTs: parsed.messageTs,
      threadTs: parsed.threadTs,
      message,
      thread,
    }

    output.log('')
    output.log('Slack Markdown')
    output.log('')
    output.log(`Link type: ${result.linkType}`)
    output.log(`Team ID: ${result.teamId || '-'}`)
    output.log(`Channel: ${formatChannelLabel(result.channelId, result.conversationType, result.channelName)}`)
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

async function fetchMessageByCoordinates(
  client: WebClient,
  channelId: string,
  messageTs: string,
  timezone: string,
  resolveUserName: ResolveUserName,
): Promise<FetchedMessage> {
  const historyResult = await client.conversations.history({
    channel: channelId,
    oldest: messageTs,
    latest: messageTs,
    inclusive: true,
    limit: 5,
  })

  const messages = historyResult.messages || []
  const exact =
    messages.find((message) => asString((message as Record<string, unknown>).ts) === messageTs) || messages[0]

  if (!exact) {
    throw new Error(`Message ${messageTs} not found in ${channelId}`)
  }

  const messageRecord = exact as Record<string, unknown>
  const ts = asString(messageRecord.ts)
  if (!ts) {
    throw new Error(`Slack returned a message without a timestamp for ${channelId}`)
  }

  const userId = asString(messageRecord.user)
  const userName = await resolveUserName(userId)
  const text = await normalizeSlackMessageText(asString(messageRecord.text) || '', resolveUserName)

  let permalink: string | undefined
  try {
    const permalinkResult = await client.chat.getPermalink({
      channel: channelId,
      message_ts: ts,
    })
    permalink = permalinkResult.permalink
  } catch {
    // Permalink is optional metadata; continue without failing the task.
  }

  return {
    ts,
    timeLabel: formatSlackTimestamp(ts, timezone),
    text,
    userId,
    userName,
    subtype: asString(messageRecord.subtype),
    threadTs: asString(messageRecord.thread_ts),
    permalink,
  }
}

async function fetchThreadReplies(
  client: WebClient,
  channelId: string,
  threadTs: string,
  timezone: string,
  resolveUserName: ResolveUserName,
): Promise<ThreadData> {
  const replies: ThreadReply[] = []
  let cursor: string | undefined

  do {
    const response = await client.conversations.replies({
      channel: channelId,
      ts: threadTs,
      limit: 200,
      cursor,
    })

    for (const message of response.messages || []) {
      const messageRecord = message as Record<string, unknown>
      const ts = asString(messageRecord.ts)
      if (!ts || ts === threadTs) continue

      const userId = asString(messageRecord.user)
      const userName = await resolveUserName(userId)
      const text = await normalizeSlackMessageText(asString(messageRecord.text) || '', resolveUserName)

      replies.push({
        ts,
        timeLabel: formatSlackTimestamp(ts, timezone),
        text,
        userId,
        userName,
        subtype: asString(messageRecord.subtype),
      })
    }

    const metadata = response.response_metadata as Record<string, unknown> | undefined
    cursor = asString(metadata?.next_cursor)
  } while (cursor)

  return { threadTs, replies }
}

function parseSlackMessageLink(link: string): { parsed?: ParsedSlackLink; error?: string } {
  const trimmed = link.trim()
  if (!trimmed) {
    return { error: 'Slack link is empty.' }
  }

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return { error: 'Slack link is not a valid URL.' }
  }

  if (url.protocol === 'slack:') {
    return { parsed: parseDeepLink(url, trimmed) }
  }

  const hostname = url.hostname.toLowerCase()
  if (hostname === 'app.slack.com') {
    return { parsed: parseAppLink(url, trimmed) }
  }

  if (hostname.endsWith('.slack.com')) {
    return { parsed: parseWorkspaceLink(url, trimmed) }
  }

  return { error: `Unsupported Slack hostname: ${url.hostname}` }
}

function parseWorkspaceLink(url: URL, link: string): ParsedSlackLink {
  const pathParts = splitPath(url.pathname)
  let channelId: string | undefined
  let messageTs: string | undefined

  if (pathParts[0] === 'archives') {
    channelId = normalizeId(pathParts[1])
    messageTs = normalizeSlackTs(pathParts[2])
  }

  channelId = channelId || normalizeId(url.searchParams.get('cid'))
  messageTs =
    messageTs ||
    normalizeSlackTs(url.searchParams.get('message_ts')) ||
    normalizeSlackTs(url.searchParams.get('message'))

  const threadTs = normalizeSlackTs(url.searchParams.get('thread_ts'))

  return {
    link,
    linkType: 'workspace',
    teamId: normalizeId(url.searchParams.get('team')),
    channelId,
    messageTs: messageTs || threadTs,
    threadTs,
  }
}

function parseAppLink(url: URL, link: string): ParsedSlackLink {
  const pathParts = splitPath(url.pathname)
  let teamId: string | undefined
  let channelId: string | undefined
  let messageTs: string | undefined
  let threadTs: string | undefined

  if (pathParts[0] === 'client') {
    teamId = normalizeId(pathParts[1])
    channelId = normalizeId(pathParts[2])

    const pointer = pathParts[3]
    if (pointer === 'thread') {
      const threadPart = pathParts[4]
      const parsedThread = parseThreadSegment(threadPart)
      channelId = channelId || parsedThread.channelId
      threadTs = parsedThread.threadTs
    } else {
      messageTs = normalizeSlackTs(pointer)
    }
  }

  channelId = channelId || normalizeId(url.searchParams.get('cid'))
  messageTs =
    messageTs ||
    normalizeSlackTs(url.searchParams.get('message_ts')) ||
    normalizeSlackTs(url.searchParams.get('message'))
  threadTs = threadTs || normalizeSlackTs(url.searchParams.get('thread_ts'))

  return {
    link,
    linkType: 'app',
    teamId: teamId || normalizeId(url.searchParams.get('team')),
    channelId,
    messageTs: messageTs || threadTs,
    threadTs,
  }
}

function parseDeepLink(url: URL, link: string): ParsedSlackLink {
  const teamId = normalizeId(url.searchParams.get('team'))
  const channelId = normalizeId(
    url.searchParams.get('id') || url.searchParams.get('channel') || url.searchParams.get('cid'),
  )
  const messageTs = normalizeSlackTs(
    url.searchParams.get('message') || url.searchParams.get('message_ts') || url.searchParams.get('ts'),
  )
  const threadTs = normalizeSlackTs(url.searchParams.get('thread_ts'))

  return {
    link,
    linkType: 'deeplink',
    teamId,
    channelId,
    messageTs: messageTs || threadTs,
    threadTs,
  }
}

function parseThreadSegment(input: string | undefined): { channelId?: string; threadTs?: string } {
  if (!input) return {}

  const splitAt = input.indexOf('-')
  if (splitAt === -1) return {}

  const channelId = normalizeId(input.slice(0, splitAt))
  const threadTs = normalizeSlackTs(input.slice(splitAt + 1))

  return { channelId, threadTs }
}

function splitPath(pathname: string): string[] {
  return pathname.split('/').filter((part) => part.length > 0)
}

function normalizeId(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  const normalized = value.trim().toUpperCase()
  if (!normalized) return undefined
  if (!/^[A-Z0-9]+$/.test(normalized)) return undefined
  return normalized
}

function normalizeSlackTs(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  const raw = value.trim()
  if (!raw) return undefined

  if (/^\d+\.\d+$/.test(raw)) {
    return raw
  }

  if (/^p\d+$/.test(raw)) {
    const digits = raw.slice(1)
    if (digits.length <= 6) return undefined
    return `${digits.slice(0, -6)}.${digits.slice(-6)}`
  }

  if (/^\d+$/.test(raw) && raw.length > 6) {
    return `${raw.slice(0, -6)}.${raw.slice(-6)}`
  }

  return undefined
}

function inferConversationType(channelId: string): ConversationType {
  if (channelId.startsWith('D')) return 'dm'
  if (channelId.startsWith('G')) return 'group'
  if (channelId.startsWith('C')) return 'channel'
  return 'unknown'
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function createUserNameResolver(client: WebClient): ResolveUserName {
  const cache = new Map<string, string | undefined>()

  return async (userId?: string): Promise<string | undefined> => {
    if (!userId) return undefined
    if (cache.has(userId)) return cache.get(userId)

    try {
      const userInfo = await client.users.info({ user: userId })
      const user = userInfo.user as Record<string, unknown> | undefined
      const profile = user?.profile as Record<string, unknown> | undefined

      const userName =
        asString(profile?.real_name_normalized) ||
        asString(profile?.real_name) ||
        asString(user?.real_name) ||
        asString(profile?.display_name_normalized) ||
        asString(profile?.display_name) ||
        asString(user?.name)

      cache.set(userId, userName)
      return userName
    } catch {
      cache.set(userId, undefined)
      return undefined
    }
  }
}

async function normalizeSlackMessageText(text: string, resolveUserName: ResolveUserName): Promise<string> {
  let normalized = normalizeFences(decodeSlackEntities(text))

  const mentionedUserIds = collectMentionedUserIds(normalized)
  if (mentionedUserIds.length === 0) return normalized

  const userNames = new Map<string, string | undefined>()
  await Promise.all(
    mentionedUserIds.map(async (userId) => {
      userNames.set(userId, await resolveUserName(userId))
    }),
  )

  normalized = normalized.replace(/<@([A-Z0-9]+)(?:\|[^>]+)?>/g, (_fullMatch, userId: string) => {
    const userName = userNames.get(userId)
    return userName ? `@${userName}` : `<@${userId}>`
  })

  return normalized
}

function collectMentionedUserIds(text: string): string[] {
  const ids = new Set<string>()
  const mentionRegex = /<@([A-Z0-9]+)(?:\|[^>]+)?>/g
  let match: RegExpExecArray | null

  while ((match = mentionRegex.exec(text)) !== null) {
    ids.add(match[1])
  }

  return [...ids]
}

function decodeSlackEntities(text: string): string {
  return text
    .replaceAll('&gt;', '>')
    .replaceAll('&lt;', '<')
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
}

type ChannelInfo = { name?: string; members?: string[]; detectedType?: ConversationType }

async function resolveChannelInfo(
  client: WebClient,
  channelId: string,
  resolveUserName: ResolveUserName,
): Promise<ChannelInfo> {
  try {
    const info = await client.conversations.info({ channel: channelId })
    const channel = info.channel as Record<string, unknown> | undefined
    if (!channel) return {}

    // Use API flags to detect actual conversation type (ID prefix is unreliable)
    if (channel.is_im === true) {
      const dmUserId = asString(channel.user as string | undefined)
      const dmUserName = await resolveUserName(dmUserId)
      if (dmUserName) return { name: `DM with ${dmUserName}`, members: [dmUserName], detectedType: 'dm' }
      return { detectedType: 'dm' }
    }

    if (channel.is_mpim === true) {
      const memberNames = await resolveGroupDmMembers(client, channelId, resolveUserName)
      const name = memberNames.length > 0 ? `DM with ${formatNameList(memberNames)}` : undefined
      return { name, members: memberNames.length > 0 ? memberNames : undefined, detectedType: 'group' }
    }

    // Regular channel — use the name field
    const name = asString(channel.name)
    return { name, detectedType: 'channel' }
  } catch {
    // Best-effort metadata lookup only.
    return {}
  }
}

async function resolveGroupDmMembers(
  client: WebClient,
  channelId: string,
  resolveUserName: ResolveUserName,
): Promise<string[]> {
  try {
    const result = await client.conversations.members({ channel: channelId })
    const memberIds = result.members || []

    const names: string[] = []
    for (const id of memberIds) {
      const name = await resolveUserName(id)
      if (name) names.push(name)
    }
    return names
  } catch {
    return []
  }
}

function formatNameList(names: string[]): string {
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
}

function formatChannelLabel(channelId: string, conversationType: ConversationType, channelName?: string): string {
  const typeLabel = `(${channelId}, ${conversationType})`
  if (!channelName) return typeLabel

  if (conversationType === 'channel') {
    return `#${channelName} ${typeLabel}`
  }

  return `${channelName} ${typeLabel}`
}

function outputMessageBlock(
  output: { log: (message: string) => void },
  message: {
    ts: string
    timeLabel?: string
    text: string
    userId?: string
    userName?: string
    subtype?: string
  },
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

function formatSlackTimestamp(ts: string, timezone: string): string {
  const seconds = Number.parseFloat(ts)
  if (!Number.isFinite(seconds)) return ts

  const epochMs = Math.round(seconds * 1000)
  const formatter = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    hourCycle: 'h23',
    timeZone: timezone,
  })
  const parts = formatter.formatToParts(epochMs)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value
  const hour = parts.find((part) => part.type === 'hour')?.value
  const minute = parts.find((part) => part.type === 'minute')?.value

  if (!year || !month || !day || !hour || !minute) return ts
  return `${year}-${month}-${day} ${hour}:${minute}`
}

function formatUserLabel(userId?: string, userName?: string): string {
  if (userName) return userName
  return userId || '-'
}
