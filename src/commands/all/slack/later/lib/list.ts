import colors from 'picocolors'
import { collectChannelIds, collectSubteamIds, collectUserIds } from '#commands/all/slack/cli/lib/agent-slack/mod.ts'
import parseLaterList from '#commands/all/slack/cli/lib/agent-slack/parseLaterList.ts'
import type {
  AgentSlackLaterItem,
  AgentSlackLaterList,
  AgentSlackMessage,
} from '#commands/all/slack/cli/lib/agent-slack/types.ts'
import { runAgentSlack } from '#commands/all/slack/lib/agentSlack.ts'
import { oneLine } from '#commands/all/slack/lib/mod.ts'
import { mpdmMemberHandles } from '#commands/all/slack/lib/mpdmMembers.ts'
import resolveContent from '#commands/all/slack/lib/resolveContent.ts'
import {
  type DmMembership,
  fetchDmMembership,
  resolveChannelNames,
  resolveHandleNames,
  resolveUsergroupNames,
  resolveUserNames,
} from '#commands/all/slack/lib/resolveNames.ts'
import hyperlink from '#lib/terminal/hyperlink.ts'

/** Fetch and parse the in-progress items from Slack's Later list. */
export async function fetchInProgressLater(limit: number): Promise<{ list: AgentSlackLaterList } | { error: string }> {
  const listResult = await runAgentSlack([
    'later',
    'list',
    '--state',
    'in_progress',
    '--limit',
    String(limit),
    '--max-body-chars',
    '300',
  ])
  if (!listResult.success) {
    const detail = listResult.stderr.trim() || listResult.stdout.trim()
    const hint = detail.includes('invalid_auth') ? ' — credentials expired, run `sky slack:auth`' : ''
    return { error: `agent-slack later list failed: ${detail}${hint}` }
  }
  const list = parseLaterList(listResult.stdout)
  if (!list) {
    return { error: `Failed to parse agent-slack later list output: ${oneLine(listResult.stdout, 200)}` }
  }
  return { list }
}

/** Conversation label for a later item: person for DMs, members for group DMs, #name for channels. */
export function laterChannelLabel(item: AgentSlackLaterItem, members?: string[]): string {
  // D-prefixed conversation ids are DMs (person, no #); group DMs list their
  // members — the resolved display names when given, slug handles otherwise
  const isDm = item.channel_id.startsWith('D')
  const name = item.channel_name?.replace(/^#/, '')
  const groupHandles = mpdmMemberHandles(name)
  if (groupHandles.length > 0) return (members?.length ? members : groupHandles).join(', ')
  return name ? (isDm ? name : `#${name}`) : item.channel_id
}

/** The form --channel matching compares on: trimmed, #-stripped, lowercased. */
export function normalizeChannelQuery(name: string): string {
  return name.trim().replace(/^#/, '').toLowerCase()
}

/** Whether a --channel query names this item's conversation — exact match after normalizing. */
export function laterChannelMatches(item: AgentSlackLaterItem, query: string): boolean {
  if (!item.channel_name) return false
  return normalizeChannelQuery(item.channel_name) === normalizeChannelQuery(query)
}

/**
 * The name a --channel query would have to give to match this item: #name for
 * channels, the person for DMs, the raw slug for group DMs. Unlike
 * laterChannelLabel this never substitutes group members — their names don't
 * match, the slug does.
 */
export function laterMatchableName(item: AgentSlackLaterItem): string | undefined {
  const name = item.channel_name?.replace(/^#/, '')
  if (!name) return undefined
  return laterConversationKind(item) === 'channel' ? `#${name}` : name
}

/** Permalink to a later item's origin message. */
export function laterItemLink(workspace: string, item: AgentSlackLaterItem): string {
  return `${workspace}/archives/${item.channel_id}/p${item.ts.replace('.', '')}`
}

/**
 * Browser-client form of the message link. Workspace-domain archive links
 * greet a browser with Slack's "open the app" interstitial; app.slack.com is
 * the web client's own host, so it lands straight in the conversation.
 * Thread replies carry thread_ts/cid like Slack's own copy-link, so the
 * client opens the thread pane rather than scrolling channel history the
 * reply isn't in.
 */
export function laterBrowserLink(item: AgentSlackLaterItem): string {
  const base = `https://app.slack.com/archives/${item.channel_id}/p${item.ts.replace('.', '')}`
  const threadTs = item.message?.thread_ts
  return laterIsThreadReply(item) && threadTs ? `${base}?thread_ts=${threadTs}&cid=${item.channel_id}` : base
}

/** Conversation kind for a later item — drives the row label's color. */
export type LaterConversationKind = 'channel' | 'dm' | 'group' | 'unknown'

export function laterConversationKind(item: AgentSlackLaterItem): LaterConversationKind {
  if (!item.channel_name) return 'unknown'
  if (item.channel_id.startsWith('D')) return 'dm'
  if (mpdmMemberHandles(item.channel_name.replace(/^#/, '')).length > 0) return 'group'
  return 'channel'
}

const KIND_COLOR: Record<LaterConversationKind, (label: string) => string> = {
  channel: colors.cyan,
  dm: colors.magenta,
  group: colors.magenta,
  unknown: colors.red,
}

const GROUP_RANK: Record<LaterConversationKind, number> = { channel: 0, dm: 1, group: 1, unknown: 2 }

/**
 * Grouped-listing order key: channels first, then people (DMs and group DMs
 * together), dead-id debris last; alphabetical within each block. The id
 * suffix keeps two same-named conversations from interleaving. Sort by this
 * key, then ts, so a conversation's items stay in reading order.
 */
export function laterGroupKey(item: AgentSlackLaterItem, members?: string[]): string {
  const label = laterChannelLabel(item, members).replace(/^#/, '').toLowerCase()
  return `${GROUP_RANK[laterConversationKind(item)]}:${label}:${item.channel_id}`
}

/** What a dead conversation id resolved to, inferred from timestamp twins in the same fetch. */
export type StaleChannelInfo = {
  /** Channel name taken from a same-ts item under a live id */
  name?: string
  /** ts values that also exist under the live id — the same message saved twice */
  duplicateTs: Set<string>
}

/**
 * Resolve conversation ids the export returned without names. A migrated or
 * reconnected channel gets a new id, and saves made under the old id keep
 * referencing the dead one. Any such item whose message ts also appears under
 * a named id is the same message saved twice — which both names the dead id
 * (for every item that shares it) and marks that item a duplicate.
 */
export function resolveStaleChannels(items: AgentSlackLaterItem[]): Map<string, StaleChannelInfo> {
  const namedByTs = new Map<string, string>()
  for (const item of items) {
    if (item.channel_name) namedByTs.set(item.ts, item.channel_name)
  }
  const stale = new Map<string, StaleChannelInfo>()
  for (const item of items) {
    if (item.channel_name) continue
    const info = stale.get(item.channel_id) ?? { duplicateTs: new Set<string>() }
    const twin = namedByTs.get(item.ts)
    if (twin) {
      info.name ??= twin
      info.duplicateTs.add(item.ts)
    }
    stale.set(item.channel_id, info)
  }
  return stale
}

/** Whether a capture run can act on the item — a dead conversation id always fails the message fetch. */
export function laterCapturable(item: AgentSlackLaterItem): boolean {
  return Boolean(item.channel_name)
}

/**
 * Whether the saved message is a reply inside a thread rather than the thread
 * parent — Slack stamps thread_ts on every threaded message, and it equals the
 * message's own ts only on the parent.
 */
export function laterIsThreadReply(item: AgentSlackLaterItem): boolean {
  const threadTs = item.message?.thread_ts
  return threadTs !== undefined && threadTs !== item.ts
}

/**
 * Backfill rows the Later export returned bodyless. Its hydration reads
 * channel history, which never contains non-broadcast thread replies — the
 * very rows the thread-reply marker exists for — so fetch each missing
 * message directly: `message get` resolves thread replies through
 * conversations.replies. Rows that still fail (deleted messages, dead
 * conversation ids) keep their placeholder.
 */
export async function backfillMissingMessages(
  rows: Array<{ item: AgentSlackLaterItem; link: string }>,
  fetchMessage: (link: string) => Promise<AgentSlackMessage | undefined> = fetchLaterMessage,
): Promise<void> {
  const missing = rows.filter((row) => !row.item.message && laterCapturable(row.item))
  await Promise.all(
    missing.map(async (row) => {
      const message = await fetchMessage(row.link)
      if (!message || message.ts !== row.item.ts) return
      row.item.message = { content: message.content, thread_ts: message.thread_ts }
    }),
  )
}

async function fetchLaterMessage(link: string): Promise<AgentSlackMessage | undefined> {
  const result = await runAgentSlack(['message', 'get', link, '--max-body-chars', '300'])
  if (!result.success) return undefined
  try {
    const data = JSON.parse(result.stdout) as { message?: AgentSlackMessage }
    return data.message
  } catch {
    return undefined
  }
}

/** The three name maps mention substitution needs, resolvable independently for tests. */
export type MentionResolvers = {
  users: (ids: string[]) => Promise<Map<string, string>>
  channels: (ids: string[], userNames: Map<string, string>) => Promise<Map<string, string>>
  usergroups: (ids: string[]) => Promise<Map<string, string>>
}

const liveMentionResolvers = (workspace: string): MentionResolvers => ({
  users: (ids) => resolveUserNames(ids, workspace),
  channels: (ids, userNames) => resolveChannelNames(ids, userNames, workspace),
  usergroups: (ids) => resolveUsergroupNames(ids, workspace),
})

/** Group-DM member-name sources, injectable for tests. */
export type GroupMemberResolvers = {
  membership: () => Promise<DmMembership>
  users: (ids: string[]) => Promise<Map<string, string>>
  handles: (handles: string[]) => Promise<Map<string, string>>
}

const liveGroupMemberResolvers = (workspace: string): GroupMemberResolvers => ({
  membership: () => fetchDmMembership(workspace),
  users: (ids) => resolveUserNames(ids, workspace),
  handles: (handles) => resolveHandleNames(handles, workspace),
})

/**
 * Display names for each group-DM row's head line, keyed by conversation id,
 * with the session user excluded (like Slack's own header). Names come from
 * live membership — mpdm slugs are creation-time state, so renames, moved
 * conversations, and later-added members never reach them. Rows the boot
 * payload doesn't cover fall back to name-resolved slug handles; rows that
 * resolve nowhere keep the raw slug label via the renderer's fallback.
 */
export async function resolveRowMemberNames(
  rows: Array<{ item: AgentSlackLaterItem }>,
  workspace: string,
  resolvers: GroupMemberResolvers = liveGroupMemberResolvers(workspace),
): Promise<Map<string, string[]>> {
  const groupRows = rows.filter((row) => laterConversationKind(row.item) === 'group')
  const members = new Map<string, string[]>()
  if (groupRows.length === 0) return members

  const { selfId, membersByChannel } = await resolvers.membership()
  const rowIds = new Map<string, string[]>()
  const wantedUserIds = new Set<string>()
  for (const row of groupRows) {
    const ids = (membersByChannel.get(row.item.channel_id) ?? []).filter((id) => id !== selfId)
    rowIds.set(row.item.channel_id, ids)
    for (const id of ids) wantedUserIds.add(id)
  }
  const userNames = wantedUserIds.size > 0 ? await resolvers.users([...wantedUserIds]) : new Map<string, string>()

  const slugHandles = new Set<string>()
  for (const row of groupRows) {
    const names = (rowIds.get(row.item.channel_id) ?? [])
      .map((id) => userNames.get(id))
      .filter((name): name is string => Boolean(name))
    if (names.length > 0) {
      members.set(row.item.channel_id, names)
    } else {
      for (const handle of mpdmMemberHandles(row.item.channel_name?.replace(/^#/, ''))) slugHandles.add(handle)
    }
  }

  if (slugHandles.size > 0) {
    const handleNames = await resolvers.handles([...slugHandles])
    for (const row of groupRows) {
      if (members.has(row.item.channel_id)) continue
      const handles = mpdmMemberHandles(row.item.channel_name?.replace(/^#/, ''))
      if (handles.length > 0) {
        members.set(
          row.item.channel_id,
          handles.map((handle) => handleNames.get(handle) || handle),
        )
      }
    }
  }
  return members
}

/**
 * Replace mention ids in the rows' message bodies with names, in place — the
 * agent-slack export renders `<@U…>` as a bare `@U…` id and leaves `<#C…>`
 * and `<!subteam^S…>` raw, since its Later feed resolves nothing. Ids that
 * still resolve nowhere degrade to readable bracket-stripped forms. Run after
 * backfillMissingMessages so backfilled bodies are covered too.
 */
export async function resolveRowMentions(
  rows: Array<{ item: AgentSlackLaterItem }>,
  workspace: string,
  resolvers: MentionResolvers = liveMentionResolvers(workspace),
): Promise<void> {
  const bodies = rows.flatMap((row) => (row.item.message?.content ? [{ content: row.item.message.content }] : []))
  if (bodies.length === 0) return
  const userNames = await resolvers.users(collectUserIds(bodies))
  const channelNames = await resolvers.channels(collectChannelIds(bodies), userNames)
  const usergroupNames = await resolvers.usergroups(collectSubteamIds(bodies))
  for (const row of rows) {
    const message = row.item.message
    if (message?.content) message.content = resolveContent(message.content, userNames, channelNames, usergroupNames)
  }
}

export type LaterRowContext = {
  /** Dead-id resolutions from resolveStaleChannels; without one, unnamed rows fall back to the raw id */
  stale?: Map<string, StaleChannelInfo>
  /** Group-DM member names by conversation id, from resolveRowMemberNames; labels fall back to slug handles */
  groupMembers?: Map<string, string[]>
  maxSnippet?: number
  /**
   * Render the time as an OSC-8 hyperlink (true) or print the raw url as a
   * third line (false). Defaults to color support so terminals get links and
   * pipes get urls — but the default is environment-sniffed (CI counts as
   * color-capable), so tests must pin it.
   */
  hyperlinks?: boolean
  /** Drop the conversation label from the head line — grouped listings carry it in the group header */
  omitLabel?: boolean
  /** Leading whitespace for the head line; snippet and url lines sit 4 further in */
  indent?: string
}

/**
 * Colored conversation label for a row or a group header: kind-colored name,
 * twin-inferred name with a stale or duplicate note for rows whose
 * conversation id no longer resolves, a red marker when nothing names it.
 */
export function renderLaterLabel(
  item: AgentSlackLaterItem,
  context: Pick<LaterRowContext, 'stale' | 'groupMembers'> = {},
): string {
  const kind = laterConversationKind(item)
  if (kind !== 'unknown') {
    return colors.bold(KIND_COLOR[kind](laterChannelLabel(item, context.groupMembers?.get(item.channel_id))))
  }
  const staleInfo = context.stale?.get(item.channel_id)
  if (staleInfo?.name) {
    const note = staleInfo.duplicateTs.has(item.ts) ? 'duplicate save — stale channel id' : 'stale channel id'
    return colors.yellow(`#${staleInfo.name}`) + colors.dim(` (${note})`)
  }
  return colors.red(`⚠ unavailable channel ${item.channel_id}`)
}

/**
 * One queue row: a numbered head line (time, conversation, thread-reply
 * marker, reply count) and a snippet line. The time is an OSC-8 hyperlink to
 * the message, so no url is printed on a terminal — piped output gets it as a
 * third line. Saved thread replies carry a yellow marker so they read
 * distinctly from thread parents. Rows whose conversation id no longer
 * resolves show the twin-inferred name and a stale or duplicate marker
 * instead of a bare id, and rows the export returned bodyless get a labeled
 * placeholder instead of a blank snippet.
 */
export function renderLaterRow(
  row: { item: AgentSlackLaterItem; timeLabel: string; link: string },
  index: number,
  context: LaterRowContext = {},
): string[] {
  const { item, timeLabel, link } = row
  const hyperlinks = context.hyperlinks ?? colors.isColorSupported
  const indent = context.indent ?? '  '
  const kind = laterConversationKind(item)
  const staleInfo = kind === 'unknown' ? context.stale?.get(item.channel_id) : undefined
  const duplicate = staleInfo?.duplicateTs.has(item.ts) ?? false

  const label = context.omitLabel ? '' : `  ${renderLaterLabel(item, context)}`

  const threadBadge = laterIsThreadReply(item) ? colors.yellow('  ↳ thread reply') : ''
  const replies = item.message?.reply_count
  const replyBadge = replies ? colors.dim(`  ↩ ${replies}`) : ''

  const body = item.message ? oneLine(item.message.content ?? '', context.maxSnippet ?? 100) : ''
  const placeholder = duplicate
    ? '(same message as its live twin in this queue)'
    : item.message
      ? '(no text)'
      : '(no preview — message not fetched)'
  const snippet = body === '' ? colors.dim(placeholder) : body

  // The clickable link is the browser-client form; the piped url line keeps
  // the workspace permalink — the copy-pasteable, capture-parseable spelling
  const lines = [
    `${indent}${colors.dim(`${String(index + 1).padStart(2)}.`)} ${colors.dim(hyperlinks ? hyperlink(timeLabel, laterBrowserLink(item)) : timeLabel)}${label}${threadBadge}${replyBadge}`,
    `${indent}    ${snippet}`,
  ]
  if (!hyperlinks) lines.push(`${indent}    ${link}`)
  return lines
}
