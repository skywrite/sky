/**
 * Name resolution for Slack ids — users, channels, and usergroups — shared by
 * the capture path (slack:cli:export) and the later-queue listing.
 *
 * Network-heavy: spawns `agent-slack` per user and calls the workspace API on
 * the keychain browser credentials. Import directly, not via lib/mod.ts (that
 * barrel is reserved for pure helpers).
 */

import { type AgentSlackUser, parseUser } from '#commands/all/slack/cli/lib/agent-slack/mod.ts'
import { runAgentSlack } from './agentSlack.ts'
import formatNameList from './formatNameList.ts'
import { mpdmMemberHandles } from './mpdmMembers.ts'
import { slackApiCall, slackEdgeApiCall } from './slack-api.ts'
import type { ConversationType } from './types.ts'

/** Display name from a raw Slack user object — same precedence as parseUser. */
function pickUserName(user: Record<string, unknown>): string | undefined {
  const profile = (user.profile ?? {}) as Record<string, unknown>
  const candidates = [user.real_name, profile.real_name, profile.display_name, user.name]
  for (const value of candidates) {
    if (typeof value === 'string' && value) return value
  }
  return undefined
}

/** The enterprise id behind the keychain session (Grid orgs), or undefined outside Grid. */
async function enterpriseIdFor(workspaceUrl: string, api: typeof slackApiCall): Promise<string | undefined> {
  const auth = await api(workspaceUrl, 'auth.test', {})
  const enterpriseId = auth?.enterprise_id
  return typeof enterpriseId === 'string' && enterpriseId ? enterpriseId : undefined
}

/**
 * Resolve user ids to display names. One bulk edge-cache call covers every id
 * on Enterprise Grid; leftovers (and non-Grid workspaces) fall back to per-id
 * agent-slack lookups with the users.info fallback. Ids that resolve nowhere
 * are absent from the map, so mention substitution degrades to the raw id.
 */
export async function resolveUserNames(
  userIds: string[],
  workspaceUrl?: string,
  api: typeof slackApiCall = slackApiCall,
  edge: typeof slackEdgeApiCall = slackEdgeApiCall,
): Promise<Map<string, string>> {
  const userNames = new Map<string, string>()
  if (userIds.length === 0) return userNames
  if (workspaceUrl) {
    const enterpriseId = await enterpriseIdFor(workspaceUrl, api)
    if (enterpriseId) {
      const json = await edge(workspaceUrl, enterpriseId, 'users/info', { ids: userIds })
      const results = Array.isArray(json?.results) ? (json.results as Record<string, unknown>[]) : []
      for (const user of results) {
        const id = typeof user.id === 'string' ? user.id : undefined
        const name = pickUserName(user)
        if (id && name) userNames.set(id, name)
      }
    }
  }
  const missing = userIds.filter((id) => !userNames.has(id))
  await Promise.all(missing.map((id) => resolveUserName(id, userNames, workspaceUrl)))
  return userNames
}

/**
 * Resolve one user id, memoized through the given map: agent-slack first,
 * then users.info on the keychain creds when agent-slack has no full name
 * (Slack Connect users often surface only their handle there).
 */
export async function resolveUserName(
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

export type DmMembership = { selfId?: string; membersByChannel: Map<string, string[]> }

/**
 * Live member ids of the session user's DMs and group DMs, from the client
 * boot payload — conversations.members is enterprise_is_restricted under
 * Grid, and mpdm slug handles are creation-time state: renames, moved
 * conversations, and later-added members (the session user included) never
 * reach the slug.
 */
export async function fetchDmMembership(
  workspaceUrl: string,
  api: typeof slackApiCall = slackApiCall,
): Promise<DmMembership> {
  const membersByChannel = new Map<string, string[]>()
  const boot = await api(workspaceUrl, 'client.userBoot', {})
  if (!boot) return { membersByChannel }
  const self = boot.self as Record<string, unknown> | undefined
  const selfId = typeof self?.id === 'string' ? self.id : undefined
  for (const key of ['channels', 'ims', 'mpims', 'groups']) {
    const section = boot[key]
    if (!Array.isArray(section)) continue
    for (const channel of section as Record<string, unknown>[]) {
      const id = typeof channel.id === 'string' ? channel.id : undefined
      const members = Array.isArray(channel.members)
        ? (channel.members as unknown[]).filter((m): m is string => typeof m === 'string')
        : []
      if (id && members.length > 0) membersByChannel.set(id, members)
    }
  }
  return { selfId, membersByChannel }
}

export type ChannelInfo = { name?: string; members?: string[]; detectedType?: ConversationType }

/** Resolve one conversation id to its name, members, and actual type via conversations.info. */
export async function resolveChannelInfo(
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
    // members feed the to: field (full list — resolveRecipient drops only the
    // author, and self belongs there, matching the DM convention); the label
    // excludes self, like Slack's own conversation header
    let memberNames = await resolveGroupDmMembers(channelId, userNames, workspaceUrl)
    let labelNames = memberNames
    if (memberNames.length === 0) {
      // Enterprise Grid blocks conversations.members — take live member ids
      // from the client boot payload instead
      const { selfId, membersByChannel } = await fetchDmMembership(workspaceUrl)
      const memberIds = membersByChannel.get(channelId) ?? []
      if (memberIds.length > 0) {
        const names = await resolveUserNames(memberIds, workspaceUrl)
        const toNames = (ids: string[]): string[] =>
          ids.map((id) => names.get(id)).filter((name): name is string => Boolean(name))
        memberNames = toNames(memberIds)
        labelNames = toNames(memberIds.filter((id) => id !== selfId))
      }
    }
    if (memberNames.length === 0) {
      // last resort: the slug's creation-time handles
      memberNames = await resolveMpdmSlugMembers(channel.name as string | undefined, workspaceUrl)
      labelNames = memberNames
    }
    const name = labelNames.length > 0 ? `DM with ${formatNameList(labelNames)}` : undefined
    return { name, members: memberNames.length > 0 ? memberNames : undefined, detectedType: 'group' }
  }

  // Regular channel — use the name field
  const name = channel.name as string | undefined
  return { name, detectedType: 'channel' }
}

/** Resolve <#C…> mention ids to channel names; ids the session can't see are simply absent. */
export async function resolveChannelNames(
  channelIds: string[],
  userNames: Map<string, string>,
  workspaceUrl: string,
): Promise<Map<string, string>> {
  const channelNames = new Map<string, string>()
  for (const id of channelIds) {
    const info = await resolveChannelInfo(id, userNames, workspaceUrl)
    if (info.name) channelNames.set(id, info.name)
  }
  return channelNames
}

/**
 * Resolve <!subteam^S…> usergroup ids to their @handles. Classic
 * usergroups.list first (disabled groups included — old captures reference
 * retired teams); under Enterprise Grid that returns ok-but-empty for browser
 * tokens, so remaining ids go to the edge cache API scoped by the
 * enterprise id from auth.test. Ids that resolve nowhere are absent, so
 * mentions degrade to readable @S… ids.
 */
export async function resolveUsergroupNames(
  subteamIds: string[],
  workspaceUrl: string,
  api: typeof slackApiCall = slackApiCall,
  edge: typeof slackEdgeApiCall = slackEdgeApiCall,
): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  if (subteamIds.length === 0) return names
  const wanted = new Set(subteamIds)

  const collect = (groups: unknown): void => {
    if (!Array.isArray(groups)) return
    for (const group of groups as Record<string, unknown>[]) {
      const id = typeof group.id === 'string' ? group.id : undefined
      if (!id || !wanted.has(id) || names.has(id)) continue
      const handle = typeof group.handle === 'string' ? group.handle : ''
      const title = typeof group.name === 'string' ? group.name : ''
      const name = handle || title
      if (name) names.set(id, name)
    }
  }

  const classic = await api(workspaceUrl, 'usergroups.list', { include_disabled: true })
  collect(classic?.usergroups)

  const missing = subteamIds.filter((id) => !names.has(id))
  if (missing.length > 0) {
    const auth = await api(workspaceUrl, 'auth.test', {})
    const enterpriseId = auth?.enterprise_id
    if (typeof enterpriseId === 'string' && enterpriseId) {
      const json = await edge(workspaceUrl, enterpriseId, 'usergroups/info', { ids: missing })
      collect(json?.results)
    }
  }
  return names
}

/** Non-Grid users.list sweep ceiling — 200 users per page; misses past this stay handles. */
const MAX_USER_PAGES = 25

/**
 * Resolve user handles ("bob.smith") to display names — never via per-handle
 * agent-slack lookups: its handle path paginates the whole directory per
 * handle, and one that matches nobody (bots, renamed accounts) scans it to
 * exhaustion, so a batch of parallel lookups rate-limits a listing into
 * minutes. On Enterprise Grid each handle is one edge people-search call
 * (exact name match only — the endpoint is fuzzy); elsewhere one bounded
 * users.list sweep covers them all. Handles that resolve nowhere are absent.
 */
export async function resolveHandleNames(
  handles: string[],
  workspaceUrl?: string,
  api: typeof slackApiCall = slackApiCall,
  edge: typeof slackEdgeApiCall = slackEdgeApiCall,
): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  if (handles.length === 0 || !workspaceUrl) return names

  const enterpriseId = await enterpriseIdFor(workspaceUrl, api)
  if (enterpriseId) {
    await Promise.all(
      handles.map(async (handle) => {
        const json = await edge(workspaceUrl, enterpriseId, 'users/search', { query: handle, count: 5, fuzz: 1 })
        const results = Array.isArray(json?.results) ? (json.results as Record<string, unknown>[]) : []
        const hit = results.find(
          (user) => typeof user.name === 'string' && user.name.toLowerCase() === handle.toLowerCase(),
        )
        const name = hit ? pickUserName(hit) : undefined
        if (name) names.set(handle, name)
      }),
    )
    return names
  }

  const wanted = new Map(handles.map((handle) => [handle.toLowerCase(), handle]))
  let cursor: string | undefined
  for (let page = 0; page < MAX_USER_PAGES; page++) {
    const json = await api(workspaceUrl, 'users.list', { limit: 200, ...(cursor ? { cursor } : {}) })
    if (!json) break
    const members = Array.isArray(json.members) ? (json.members as Record<string, unknown>[]) : []
    for (const member of members) {
      const handle = typeof member.name === 'string' ? wanted.get(member.name.toLowerCase()) : undefined
      if (!handle || names.has(handle)) continue
      const name = pickUserName(member)
      if (name) names.set(handle, name)
    }
    if (names.size >= wanted.size) break
    const meta = (json.response_metadata ?? {}) as Record<string, unknown>
    const next = typeof meta.next_cursor === 'string' ? meta.next_cursor : ''
    if (!next) break
    cursor = next
  }
  return names
}

/** Resolve mpdm slug handles to display names; the handle itself is the fallback. */
async function resolveMpdmSlugMembers(channelName: string | undefined, workspaceUrl: string): Promise<string[]> {
  const handles = mpdmMemberHandles(channelName)
  const names = await resolveHandleNames(handles, workspaceUrl)
  return handles.map((handle) => names.get(handle) || handle)
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
