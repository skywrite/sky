import type { AgentSlackLaterItem } from '#commands/all/slack/cli/lib/agent-slack/types.ts'
import mapLimit from '#commands/all/slack/lib/mapLimit.ts'
import { mpdmMemberHandles } from '#commands/all/slack/lib/mpdmMembers.ts'
import {
  type DmMembership,
  fetchDmMembership,
  parseConversationIdentity,
  resolveHandleProfiles,
  resolveUserProfiles,
  type SlackConversationIdentity,
  type SlackUserProfile,
} from '#commands/all/slack/lib/resolveNames.ts'
import { slackApiCall } from '#commands/all/slack/lib/slack-api.ts'
import type { ConversationType } from '#commands/all/slack/lib/types.ts'

export type LaterConversation = {
  id: string
  kind: ConversationType
  label: string
  rawName?: string
  aliases: string[]
  members: SlackUserProfile[]
  /** Exact participant queries require live, complete membership and a known session user. */
  membersComplete: boolean
  count: number
}

export type ConversationResolvers = {
  membership: () => Promise<DmMembership>
  info: (id: string) => Promise<SlackConversationIdentity | undefined>
  members: (id: string) => Promise<string[] | undefined>
  self: () => Promise<string | undefined>
  users: (ids: string[]) => Promise<Map<string, SlackUserProfile>>
  handles: (handles: string[]) => Promise<Map<string, SlackUserProfile>>
}

/** An incomplete page must never make a larger group look like an exact participant match. */
export async function fetchCompleteMembers(
  id: string,
  workspace: string,
  api: typeof slackApiCall = slackApiCall,
): Promise<string[] | undefined> {
  const members = new Set<string>()
  const cursors = new Set<string>()
  let cursor: string | undefined
  for (let page = 0; page < 100; page++) {
    const result = await api(workspace, 'conversations.members', {
      channel: id,
      limit: 200,
      ...(cursor ? { cursor } : {}),
    })
    if (!Array.isArray(result?.members) || result.members.some((member) => typeof member !== 'string')) return undefined
    for (const member of result.members as string[]) members.add(member)
    const meta = result.response_metadata as { next_cursor?: string } | undefined
    cursor = meta?.next_cursor?.trim()
    if (!cursor) return [...members]
    if (cursors.has(cursor)) return undefined
    cursors.add(cursor)
  }
  return undefined
}

const liveResolvers = (workspace: string): ConversationResolvers => ({
  membership: () => fetchDmMembership(workspace),
  info: async (id) => {
    const result = await slackApiCall(workspace, 'conversations.info', { channel: id })
    const channel = result?.channel
    return channel && typeof channel === 'object'
      ? parseConversationIdentity(channel as Record<string, unknown>)
      : undefined
  },
  members: (id) => fetchCompleteMembers(id, workspace),
  self: async () => {
    const result = await slackApiCall(workspace, 'auth.test', {})
    return typeof result?.user_id === 'string' ? result.user_id : undefined
  },
  users: (ids) => resolveUserProfiles(ids, workspace),
  handles: (handles) => resolveHandleProfiles(handles, workspace),
})

const unresolvedUser = (name: string, id?: string): SlackUserProfile => ({ id, name, aliases: [name] })

/** Resolve each fetched conversation once, before selection, sorting, or rendering. */
export async function resolveLaterConversations(
  items: AgentSlackLaterItem[],
  workspace: string,
  resolvers: ConversationResolvers = liveResolvers(workspace),
): Promise<Map<string, LaterConversation>> {
  const conversations = new Map<string, LaterConversation>()
  for (const item of items) {
    const existing = conversations.get(item.channel_id)
    if (existing) {
      existing.count++
      continue
    }
    conversations.set(item.channel_id, {
      id: item.channel_id,
      kind: 'unknown',
      label: item.channel_name ?? item.channel_id,
      rawName: item.channel_name?.replace(/^#/, ''),
      aliases: [],
      members: [],
      membersComplete: false,
      count: 1,
    })
  }
  const named = [...conversations.values()].filter((conversation) => conversation.rawName)
  if (named.length === 0) return conversations
  const boot = await resolvers.membership()
  const identities = new Map<string, SlackConversationIdentity>()
  await mapLimit(named, 6, async (conversation) => {
    const cached = boot.conversations?.get(conversation.id)
    let identity = { ...cached, memberIds: cached?.memberIds ?? boot.membersByChannel.get(conversation.id) }
    if (!identity.kind || (identity.kind !== 'channel' && !identity.memberIds?.length)) {
      const info = await resolvers.info(conversation.id)
      identity = {
        kind: info?.kind ?? identity.kind,
        name: info?.name ?? identity.name,
        memberIds: info?.memberIds ?? identity.memberIds,
      }
    }
    // D ids and mpdm slugs identify DM kinds even when metadata is unavailable.
    // A C/G id alone cannot prove "channel": Slack Connect DMs can use them too.
    conversation.kind =
      identity.kind ??
      (mpdmMemberHandles(conversation.rawName).length > 0
        ? 'group'
        : conversation.id.startsWith('D')
          ? 'dm'
          : 'unknown')
    if (conversation.kind === 'group' && !identity.memberIds?.length) {
      identity.memberIds = await resolvers.members(conversation.id)
    }
    identities.set(conversation.id, identity)
  })
  const selfId =
    boot.selfId ??
    (named.some((conversation) => conversation.kind === 'group' || conversation.kind === 'dm')
      ? await resolvers.self()
      : undefined)
  const wantedIds = new Set<string>()
  const wantedHandles = new Set<string>()
  for (const conversation of named) {
    if (conversation.kind !== 'dm' && conversation.kind !== 'group') continue
    const ids = identities.get(conversation.id)?.memberIds
    if (ids?.length) {
      for (const id of ids) if (id !== selfId) wantedIds.add(id)
    } else if (conversation.kind === 'group') {
      for (const handle of mpdmMemberHandles(conversation.rawName)) wantedHandles.add(handle)
    } else if (conversation.rawName && !/\s/.test(conversation.rawName)) {
      wantedHandles.add(conversation.rawName)
    }
  }
  const [users, handles] = await Promise.all([
    wantedIds.size ? resolvers.users([...wantedIds]) : new Map<string, SlackUserProfile>(),
    wantedHandles.size ? resolvers.handles([...wantedHandles]) : new Map<string, SlackUserProfile>(),
  ])
  for (const conversation of named) {
    const identity = identities.get(conversation.id)
    const rawName = conversation.rawName!
    if (conversation.kind === 'channel') {
      const name = identity?.name ?? rawName
      conversation.label = `#${name}`
      conversation.aliases = [name]
      continue
    }
    if (conversation.kind === 'unknown') continue
    const ids = identity?.memberIds
    if (ids?.length) {
      const others = [...new Set(ids)].filter((id) => id !== selfId)
      // Keep unresolved ids as participants: dropping them would allow subset matches.
      conversation.members = others.map(
        (id) => users.get(id) ?? unresolvedUser(conversation.kind === 'dm' && others.length === 1 ? rawName : id, id),
      )
      conversation.membersComplete = conversation.kind === 'dm' || Boolean(selfId && ids.length)
    } else if (conversation.kind === 'group') {
      conversation.members = mpdmMemberHandles(rawName)
        .map((handle) => handles.get(handle) ?? unresolvedUser(handle))
        .filter((member) => !selfId || member.id !== selfId)
    } else {
      conversation.members = [handles.get(rawName) ?? unresolvedUser(rawName)]
    }
    conversation.label = conversation.members.map((member) => member.name).join(', ') || rawName
    conversation.aliases =
      conversation.kind === 'dm'
        ? [...new Set([rawName, ...conversation.members.flatMap((member) => member.aliases)])]
        : [conversation.label, rawName]
  }
  return conversations
}
