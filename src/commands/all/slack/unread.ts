import { WebClient } from '@slack/web-api'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'

interface UnreadMessage {
  channel: string
  channelName: string
  channelType: 'dm' | 'channel' | 'group'
  from: string
  text: string
  ts: string
  time: Date
}

type UnreadConversation = {
  channel: string
  channelName: string
  channelType: 'dm' | 'channel' | 'group'
  from: string
  text: string
  time: Date
  count: number
}

type SearchChannelHint = {
  channelId: string
  channelName: string
  channelType: 'dm' | 'channel' | 'group'
  sortTs: number
}

const params = {
  token: Flag.string('Slack user token (or set SLACK_USER_TOKEN env var)', { short: 't' }),
  limit: Flag.number('Max messages per channel', { short: 'l', default: 5 }),
  max: Flag.number('Max conversations to scan (default: all)'),
  channelsOnly: Flag.boolean('Only show channel messages, skip DMs'),
  dmsOnly: Flag.boolean('Only show DM messages, skip channels'),
  search: Flag.boolean('Use search.messages path (experimental)'),
  debug: Flag.boolean('Show debug output'),
}

type Params = InferParams<typeof params>

export default class SlackUnreadTask extends Command {
  static override description: CommandDescription = {
    name: 'slack:unread',
    description: 'List unread Slack messages across channels and DMs.',
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult> {
    const { output, env } = context
    const token = args.token || env.SLACK_USER_TOKEN
    const limit = args.limit ?? 5
    const maxConversations = args.max
    const { channelsOnly, dmsOnly, search, debug } = args

    if (!token) {
      return CommandResult.fail(
        'No Slack token provided. Use --token flag or set SLACK_USER_TOKEN environment variable.',
      )
    }

    if (channelsOnly && dmsOnly) {
      return CommandResult.fail('Cannot use both --channels-only and --dms-only at the same time.')
    }

    try {
      const client = new WebClient(token)
      const allUnread: UnreadMessage[] = []

      // Get user info for resolving names
      const userCache = new Map<string, string>()

      const getUserName = async (userId: string): Promise<string> => {
        if (userCache.has(userId)) return userCache.get(userId)!
        try {
          const userInfo = await client.users.info({ user: userId })
          const name = userInfo.user?.real_name || userInfo.user?.name || userId
          userCache.set(userId, name)
          return name
        } catch {
          return userId
        }
      }

      let usedSearch = false
      if (search) {
        const searchUnread = await tryFetchUnreadViaSearch({
          client,
          limit,
          maxMessages: maxConversations ?? 150,
          dmsOnly: dmsOnly ?? false,
          channelsOnly: channelsOnly ?? false,
          debug: debug ?? false,
          log: (line) => output.log(line),
          getUserName,
        })

        if (searchUnread !== null) {
          usedSearch = true
          allUnread.push(...searchUnread)
        }
      } else if (debug) {
        output.log('Search path disabled; using conversations scan.')
      }

      if (!usedSearch) {
        // Build types filter
        const types: string[] = []
        if (!dmsOnly) types.push('public_channel', 'private_channel')
        if (!channelsOnly) types.push('im', 'mpim')

        if (debug) {
          output.log(`Debug: dmsOnly=${dmsOnly}, channelsOnly=${channelsOnly}`)
        }
        output.log(`Fetching ${dmsOnly ? 'DMs' : channelsOnly ? 'channels' : 'conversations'}...`)

        // Get conversations - need separate calls for im vs other types
        // because im conversations sometimes don't come back in mixed queries
        type Channel = NonNullable<Awaited<ReturnType<typeof client.users.conversations>>['channels']>[number]
        let allChannels: Channel[] = []

        // Helper to paginate through all conversations
        const fetchAllConversations = async (typesStr: string): Promise<Channel[]> => {
          const results: Channel[] = []
          let cursor: string | undefined
          let page = 0

          do {
            page++
            const response = await client.users.conversations({
              types: typesStr,
              exclude_archived: true,
              limit: 200,
              cursor,
            })
            results.push(...(response.channels || []))
            cursor = response.response_metadata?.next_cursor
            if (debug && page > 1) output.log(`  Page ${page}: ${response.channels?.length || 0}`)
          } while (cursor)

          return results
        }

        if (types.includes('im')) {
          if (debug) output.log('Fetching 1:1 DMs...')
          const ims = await fetchAllConversations('im')
          if (debug) output.log(`  Got ${ims.length} 1:1 DMs`)
          allChannels = [...ims]
        }

        const otherTypes = types.filter((t) => t !== 'im')
        if (otherTypes.length > 0) {
          if (debug) output.log(`Fetching ${otherTypes.join(', ')}...`)
          const others = await fetchAllConversations(otherTypes.join(','))
          if (debug) output.log(`  Got ${others.length} conversations`)
          allChannels = [...allChannels, ...others]
        }

        const conversationsResult = { channels: allChannels }

        let conversations = dedupeConversations(conversationsResult.channels || [])
        output.log(`Found ${conversations.length} conversations`)

        // Filter by type in code since API might not respect it
        if (dmsOnly) {
          const imCount = conversations.filter((c) => c.is_im).length
          const mpimCount = conversations.filter((c) => c.is_mpim).length
          output.log(`Found ${imCount} 1:1 DMs, ${mpimCount} group DMs`)
          conversations = conversations.filter((c) => c.is_im || c.is_mpim)
        } else if (channelsOnly) {
          conversations = conversations.filter((c) => !c.is_im && !c.is_mpim)
        }

        const sortedConversations = [...conversations].sort((a, b) => {
          const aSortTs = getConversationSortTs(a)
          const bSortTs = getConversationSortTs(b)
          return bSortTs - aSortTs
        })

        const searchHints = await tryFetchUnreadSearchChannelHints({
          client,
          maxChannels: Math.min(maxConversations ?? 250, 500),
          dmsOnly: dmsOnly ?? false,
          channelsOnly: channelsOnly ?? false,
          debug: debug ?? false,
          log: (line) => output.log(line),
        })

        const candidates = sortedConversations
          .map((conversation) => buildUnreadCandidate(conversation))
          .sort((a, b) => b.sortTs - a.sortTs)

        const unreadCandidates = candidates.filter((candidate) => candidate.signal === 'unread')
        const unknownCandidates = candidates.filter((candidate) => candidate.signal === 'unknown')
        const candidateById = new Map<string, UnreadCandidate>()
        for (const candidate of candidates) {
          if (!candidate.conversation.id) continue
          candidateById.set(candidate.conversation.id, candidate)
        }

        const prioritized: UnreadCandidate[] = []
        const seen = new Set<string>()
        const addCandidate = (candidate: UnreadCandidate | undefined) => {
          if (!candidate?.conversation.id) return
          if (seen.has(candidate.conversation.id)) return
          seen.add(candidate.conversation.id)
          prioritized.push(candidate)
        }

        for (const candidate of unreadCandidates) addCandidate(candidate)

        const searchHintCount = searchHints?.length || 0
        if (searchHints) {
          for (const hint of searchHints) {
            const existing = candidateById.get(hint.channelId)
            if (existing) {
              addCandidate(existing)
              continue
            }

            const syntheticConversation = {
              id: hint.channelId,
              name: hint.channelType === 'channel' ? hint.channelName : undefined,
              is_im: hint.channelType === 'dm',
              is_mpim: hint.channelType === 'group',
            } as Conversation

            addCandidate({
              conversation: syntheticConversation,
              hasUnread: true,
              lastRead: undefined,
              sortTs: hint.sortTs,
              signal: 'unread',
            })
          }
        }

        for (const candidate of unknownCandidates) addCandidate(candidate)

        const fallbackMode = prioritized.length === 0
        const scanPool = fallbackMode
          ? sortedConversations.map((conversation) => ({
              conversation,
              hasUnread: true,
              lastRead: undefined,
              sortTs: getConversationSortTs(conversation),
              signal: 'unknown' as const,
            }))
          : prioritized
        const scanLimit = maxConversations ?? scanPool.length
        const toCheck = scanPool.slice(0, scanLimit)

        if (fallbackMode) {
          output.log(
            `No unread metadata in users.conversations; checking ${toCheck.length} most recent via conversations.info/history...`,
          )
        } else {
          output.log(
            `Checking ${toCheck.length} prioritized conversations (${unreadCandidates.length} metadata-unread, ${searchHintCount} search hints, ${unknownCandidates.length} metadata-unknown)...`,
          )
        }

        let unreadConversations = 0
        let infoCalls = 0
        let historyCalls = 0

        for (const candidate of toCheck) {
          const { conversation } = candidate

          try {
            if (!conversation.id) continue

            infoCalls++
            const info = await client.conversations.info({ channel: conversation.id })
            const infoData = (info.channel || {}) as Record<string, unknown>
            const lastRead = asString(infoData.last_read) || candidate.lastRead
            const oldestTs = normalizeSlackTs(lastRead)
            const unreadCount = asNumber(infoData.unread_count)
            const unreadCountDisplay = asNumber(infoData.unread_count_display)

            const hasDisplayCount = unreadCountDisplay !== undefined
            const hasCount = unreadCount !== undefined
            const explicitNoUnread = hasDisplayCount ? unreadCountDisplay === 0 : hasCount && unreadCount === 0
            const explicitHasUnread = hasDisplayCount ? unreadCountDisplay > 0 : hasCount && unreadCount > 0
            const shouldCheckHistory = explicitHasUnread || (!explicitNoUnread && Boolean(oldestTs))

            if (!shouldCheckHistory) {
              if (debug && (hasDisplayCount || hasCount)) {
                output.log(
                  `  Skip ${conversation.id}: unread_count_display=${unreadCountDisplay} unread_count=${unreadCount}`,
                )
              }
              continue
            }

            unreadConversations++
            historyCalls++

            const historyArgs: Parameters<typeof client.conversations.history>[0] = {
              channel: conversation.id,
              limit,
            }
            if (oldestTs) {
              historyArgs.oldest = oldestTs
              historyArgs.inclusive = false
            }

            const historyResult = await client.conversations.history(historyArgs)

            const unreadMessages = (historyResult.messages || []).filter((message) => {
              if (!message.ts) return false
              if (isIgnorableUnreadMessage(message)) return false
              return compareSlackTs(message.ts, oldestTs) > 0
            })

            if (unreadMessages.length === 0) continue

            const channelType: UnreadMessage['channelType'] = conversation.is_im
              ? 'dm'
              : conversation.is_mpim
                ? 'group'
                : 'channel'

            const convData = conversation as Record<string, unknown>
            const userId = asString(convData.user)
            const channelName =
              channelType === 'dm'
                ? userId
                  ? await getUserName(userId)
                  : conversation.id || 'Unknown'
                : conversation.name || conversation.id || 'Unknown'

            if (debug) {
              const prefix = channelType === 'dm' ? '@' : '#'
              output.log(`  Found ${unreadMessages.length} unread in ${prefix}${channelName}`)
            }

            for (const msg of unreadMessages) {
              if (!msg.ts) continue
              const from = msg.user ? await getUserName(msg.user) : msg.username || 'Unknown'
              const text = normalizeMessageText(msg.text, msg.subtype)

              allUnread.push({
                channel: conversation.id,
                channelName,
                channelType,
                from,
                text,
                ts: msg.ts,
                time: new Date(parseFloat(msg.ts) * 1000),
              })
            }

            // Small delay to avoid rate limits
            await new Promise((resolve) => setTimeout(resolve, 50))
          } catch (err) {
            if (debug) {
              output.log(`  Error checking ${conversation.id}: ${err}`)
            }
          }
        }

        if (debug) {
          output.log(
            `Debug: scanned=${toCheck.length}, unread_candidates=${unreadConversations}, info_calls=${infoCalls}, history_calls=${historyCalls}`,
          )
        }
      }

      // Sort by time, newest first
      allUnread.sort((a, b) => b.time.getTime() - a.time.getTime())

      const unreadConversations = summarizeUnreadConversations(allUnread)

      // Display results
      output.log('')
      output.log(`━━━ ${unreadConversations.length} Unread Conversations (${allUnread.length} messages) ━━━`)
      output.log('')

      for (const summary of unreadConversations) {
        const prefix = summary.channelType === 'dm' ? '@' : '#'
        const timeStr = summary.time.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
        })
        const dateStr = summary.time.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
        })
        const preview = formatPreview(summary.text, 120)

        output.log(
          `[${dateStr} ${timeStr}] ${prefix}${summary.channelName} (${summary.count}) — ${summary.from}: ${preview}`,
        )
      }

      if (allUnread.length === 0) {
        output.log('No unread messages!')
      }

      return CommandResult.success({
        total: unreadConversations.length,
        totalMessages: allUnread.length,
        conversations: unreadConversations,
        messages: allUnread,
      })
    } catch (error) {
      return CommandResult.error(error as Error, 'Failed to fetch unread messages')
    }
  }
}

async function tryFetchUnreadViaSearch({
  client,
  limit,
  maxMessages,
  dmsOnly,
  channelsOnly,
  debug,
  log,
  getUserName,
}: {
  client: WebClient
  limit: number
  maxMessages: number
  dmsOnly: boolean
  channelsOnly: boolean
  debug: boolean
  log: (line: string) => void
  getUserName: (userId: string) => Promise<string>
}): Promise<UnreadMessage[] | null> {
  const queryParts = ['is:unread']
  if (dmsOnly) queryParts.push('in:dm')
  if (channelsOnly) queryParts.push('-in:dm')
  const query = queryParts.join(' ')

  try {
    if (debug) log(`Trying search.messages query: ${query}`)

    const matches: Array<Record<string, unknown>> = []
    const perPage = Math.max(20, Math.min(100, maxMessages))
    let page = 1

    while (matches.length < maxMessages) {
      const response = await client.search.messages({
        query,
        count: perPage,
        page,
        sort: 'timestamp',
        sort_dir: 'desc',
      })

      if (response.ok === false) {
        if (response.error === 'missing_scope') {
          if (debug) log('search.messages unavailable: missing_scope (requires search:read)')
          return null
        }
        throw new Error(`search.messages failed: ${response.error || 'unknown_error'}`)
      }

      const pageMatches = (response.messages?.matches || []) as Array<Record<string, unknown>>
      matches.push(...pageMatches)

      const pageInfo = response.messages?.paging as Record<string, unknown> | undefined
      const totalPages = asNumber(pageInfo?.pages) ?? page
      if (pageMatches.length === 0 || page >= totalPages) break
      page += 1
    }

    if (debug) log(`search.messages returned ${matches.length} match(es)`)

    const perConversation = new Map<string, number>()
    const unread: UnreadMessage[] = []

    for (const match of matches) {
      const channel = (match.channel as Record<string, unknown> | undefined) || {}
      const channelId = asString(channel.id) || asString(match.channel_id) || ''
      const channelName = asString(channel.name) || channelId || 'unknown'
      const isIm = asBoolean(channel.is_im)
      const isMpim = asBoolean(channel.is_mpim)
      const channelType: UnreadMessage['channelType'] = isIm ? 'dm' : isMpim ? 'group' : 'channel'

      if (dmsOnly && channelType === 'channel') continue
      if (channelsOnly && channelType !== 'channel') continue

      const ts = asString(match.ts) || asString(match.timestamp)
      if (!ts) continue

      const user = asString(match.user)
      const username = asString(match.username)
      const text = asString(match.text)
      const subtype = asString(match.subtype)
      if (isIgnorableUnreadMessage({ subtype, text, user, username })) continue

      const conversationKey = channelId || channelName
      const existingCount = perConversation.get(conversationKey) || 0
      if (existingCount >= limit) continue
      perConversation.set(conversationKey, existingCount + 1)

      const from = user ? await getUserName(user) : username || 'Unknown'
      unread.push({
        channel: channelId || channelName,
        channelName,
        channelType,
        from,
        text: normalizeMessageText(text, subtype),
        ts,
        time: new Date(Number.parseFloat(ts) * 1000),
      })

      if (unread.length >= maxMessages) break
    }

    if (debug) log(`Using search.messages results (${unread.length} unread message(s))`)
    return unread
  } catch (error) {
    if (isMissingScopeError(error)) {
      if (debug) log('search.messages unavailable: missing_scope (requires search:read)')
      return null
    }

    if (debug) log(`search.messages failed; falling back to conversations scan (${error})`)
    return null
  }
}

async function tryFetchUnreadSearchChannelHints({
  client,
  maxChannels,
  dmsOnly,
  channelsOnly,
  debug,
  log,
}: {
  client: WebClient
  maxChannels: number
  dmsOnly: boolean
  channelsOnly: boolean
  debug: boolean
  log: (line: string) => void
}): Promise<SearchChannelHint[] | null> {
  const queryParts = ['is:unread']
  if (dmsOnly) queryParts.push('in:dm')
  if (channelsOnly) queryParts.push('-in:dm')
  const query = queryParts.join(' ')

  try {
    const hints = new Map<string, SearchChannelHint>()
    const perPage = Math.max(20, Math.min(100, maxChannels))
    let page = 1

    while (hints.size < maxChannels) {
      const response = await client.search.messages({
        query,
        count: perPage,
        page,
        sort: 'timestamp',
        sort_dir: 'desc',
      })

      if (response.ok === false) {
        if (response.error === 'missing_scope') {
          if (debug) log('search.messages hints unavailable: missing_scope (requires search:read)')
          return null
        }
        throw new Error(`search.messages hints failed: ${response.error || 'unknown_error'}`)
      }

      const pageMatches = (response.messages?.matches || []) as Array<Record<string, unknown>>
      if (pageMatches.length === 0) break

      for (const match of pageMatches) {
        const channel = (match.channel as Record<string, unknown> | undefined) || {}
        const channelId = asString(channel.id) || asString(match.channel_id)
        if (!channelId) continue

        const isIm = asBoolean(channel.is_im)
        const isMpim = asBoolean(channel.is_mpim)
        const channelType: SearchChannelHint['channelType'] = isIm ? 'dm' : isMpim ? 'group' : 'channel'

        if (dmsOnly && channelType === 'channel') continue
        if (channelsOnly && channelType !== 'channel') continue

        const ts = asString(match.ts) || asString(match.timestamp)
        const sortTs = tsToNumber(ts) ?? 0
        const channelName = asString(channel.name) || channelId
        const existing = hints.get(channelId)

        if (!existing || sortTs > existing.sortTs) {
          hints.set(channelId, {
            channelId,
            channelName,
            channelType,
            sortTs,
          })
        }
      }

      const pageInfo = response.messages?.paging as Record<string, unknown> | undefined
      const totalPages = asNumber(pageInfo?.pages) ?? page
      if (page >= totalPages) break
      page += 1
    }

    const sortedHints = [...hints.values()].sort((a, b) => b.sortTs - a.sortTs).slice(0, maxChannels)
    if (debug) log(`search.messages hints found ${sortedHints.length} channel candidate(s)`)
    return sortedHints
  } catch (error) {
    if (isMissingScopeError(error)) {
      if (debug) log('search.messages hints unavailable: missing_scope (requires search:read)')
      return null
    }
    if (debug) log(`search.messages hints failed; continuing without hints (${error})`)
    return null
  }
}

function asString(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined
  return value
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function asBoolean(value: unknown): boolean {
  return value === true
}

function isIgnorableUnreadSubtype(subtype: string | undefined): boolean {
  if (!subtype) return false

  const ignoredSubtypes = new Set([
    'channel_join',
    'channel_leave',
    'channel_topic',
    'channel_purpose',
    'channel_name',
    'channel_archive',
    'channel_unarchive',
    'group_join',
    'group_leave',
    'message_deleted',
    'tombstone',
    'bot_add',
    'bot_remove',
  ])

  return ignoredSubtypes.has(subtype)
}

function isIgnorableUnreadMessage(message: {
  subtype?: string
  text?: string
  user?: string
  username?: string
}): boolean {
  if (isIgnorableUnreadSubtype(message.subtype)) return true

  const text = message.text?.trim() || ''
  const username = message.username?.toLowerCase() || ''
  const isSlackbot = message.user === 'USLACKBOT' || username === 'slackbot'

  if (text === 'This message was deleted.') return true
  if (text.startsWith('Some older messages are unavailable.')) return true
  if (isSlackbot && text.length === 0) return true

  return false
}

function getLatestTs(conversation: Record<string, unknown>): string | undefined {
  const latest = conversation.latest
  if (!latest || typeof latest !== 'object') return undefined

  const latestTs = (latest as Record<string, unknown>).ts
  return asString(latestTs)
}

function tsToNumber(ts: string | undefined): number | undefined {
  if (!ts) return undefined
  const parsed = Number.parseFloat(ts)
  return Number.isFinite(parsed) ? parsed : undefined
}

function getUpdatedMs(conversation: Record<string, unknown>): number | undefined {
  const updated = asNumber(conversation.updated)
  return updated && updated > 0 ? updated : undefined
}

function compareSlackTs(left: string | undefined, right: string | undefined): number {
  const leftNum = left ? Number.parseFloat(left) : Number.NaN
  const rightNum = right ? Number.parseFloat(right) : Number.NaN

  if (!Number.isFinite(leftNum)) return -1
  if (!Number.isFinite(rightNum)) return 1
  return leftNum - rightNum
}

function normalizeMessageText(text: string | undefined, subtype: string | undefined): string {
  if (text && text.trim().length > 0) return text
  return subtype ? `[${subtype}]` : '[non-text message]'
}

function summarizeUnreadConversations(messages: UnreadMessage[]): UnreadConversation[] {
  const summaries = new Map<string, UnreadConversation>()

  for (const message of messages) {
    const key = message.channel
    const existing = summaries.get(key)

    if (!existing) {
      summaries.set(key, {
        channel: message.channel,
        channelName: message.channelName,
        channelType: message.channelType,
        from: message.from,
        text: message.text,
        time: message.time,
        count: 1,
      })
      continue
    }

    existing.count += 1
  }

  return [...summaries.values()]
}

function formatPreview(text: string, maxLength: number): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  if (oneLine.length <= maxLength) return oneLine
  return `${oneLine.slice(0, maxLength)}...`
}

function normalizeSlackTs(ts: string | undefined): string | undefined {
  const parsed = tsToNumber(ts)
  if (!parsed || parsed <= 0) return undefined
  return ts
}

function isMissingScopeError(error: unknown): boolean {
  const errorRecord = error as Record<string, unknown>
  const message = asString(errorRecord.message) || ''
  const data = errorRecord.data as Record<string, unknown> | undefined
  const errorCode = asString(data?.error)

  return errorCode === 'missing_scope' || message.includes('missing_scope')
}

function dedupeConversations<T extends { id?: string }>(conversations: T[]): T[] {
  const byId = new Map<string, T>()

  for (const conversation of conversations) {
    if (!conversation.id) continue
    byId.set(conversation.id, conversation)
  }

  return [...byId.values()]
}

type Conversation = NonNullable<Awaited<ReturnType<WebClient['users']['conversations']>>['channels']>[number]

type UnreadCandidate = {
  conversation: Conversation
  hasUnread: boolean
  lastRead?: string
  sortTs: number
  signal: 'unread' | 'unknown' | 'read'
}

function buildUnreadCandidate(conversation: Conversation): UnreadCandidate {
  const conversationData = conversation as Record<string, unknown>
  const lastRead = asString(conversationData.last_read)
  const latestTs = getLatestTs(conversationData)
  const unreadCountDisplay = asNumber(conversationData.unread_count_display)
  const unreadCount = asNumber(conversationData.unread_count)

  const hasDisplaySignal = unreadCountDisplay !== undefined && unreadCountDisplay > 0
  const hasCountSignal = unreadCount !== undefined && unreadCount > 0
  const hasTimestampSignal = Boolean(latestTs && (!lastRead || compareSlackTs(latestTs, lastRead) > 0))

  const explicitReadFromCounts = unreadCountDisplay === 0 || unreadCount === 0
  const explicitReadFromTimestamp = Boolean(latestTs && lastRead && compareSlackTs(latestTs, lastRead) <= 0)
  const hasUnread = hasDisplaySignal || hasCountSignal || hasTimestampSignal
  const signal: UnreadCandidate['signal'] = hasUnread
    ? 'unread'
    : explicitReadFromCounts || explicitReadFromTimestamp
      ? 'read'
      : 'unknown'
  const sortTs = getConversationSortTs(conversation)

  return {
    conversation,
    hasUnread,
    lastRead,
    sortTs,
    signal,
  }
}

function getConversationSortTs(conversation: Conversation): number {
  const conversationData = conversation as Record<string, unknown>
  const latestTs = getLatestTs(conversationData)
  return tsToNumber(latestTs) ?? (getUpdatedMs(conversationData) || 0) / 1000
}
