import colors from 'picocolors'
import { collectChannelIds, collectSubteamIds, collectUserIds } from '#commands/all/slack/cli/lib/agent-slack/mod.ts'
import { formatNameList, formatSlackTimestamp, oneLine, resolveContent } from '#commands/all/slack/lib/mod.ts'
import { mpdmMemberHandles } from '#commands/all/slack/lib/mpdmMembers.ts'
import {
  type ChannelInfo,
  type DmMembership,
  fetchDmMembership,
  resolveChannelInfo,
  resolveChannelNames,
  resolveHandleNames,
  resolveUsergroupNames,
  resolveUserNames,
} from '#commands/all/slack/lib/resolveNames.ts'
import hyperlink from '#lib/terminal/hyperlink.ts'
import { draftLink, isScheduled, type SlackDraft, type SlackDraftDestination } from './drafts.ts'

export type DestinationKind = 'channel' | 'dm' | 'group' | 'unknown' | 'none'

/** A draft ready to print: names resolved, mentions substituted, link derived. */
export type DraftRow = {
  draft: SlackDraft
  timeLabel: string
  link?: string
  kind: DestinationKind
  label: string
  text: string
}

/**
 * The name sources a listing needs beyond what agent-slack hydrates,
 * injectable for tests. agent-slack names channels and DM partners; group
 * DMs arrive as mpdm slugs and the odd conversation arrives unnamed.
 */
export type DraftResolvers = {
  /** Sky's Grid-aware lookup for a conversation agent-slack could not name */
  conversation: (id: string, userNames: Map<string, string>) => Promise<ChannelInfo>
  membership: () => Promise<DmMembership>
  users: (ids: string[]) => Promise<Map<string, string>>
  handles: (handles: string[]) => Promise<Map<string, string>>
  channels: (ids: string[], userNames: Map<string, string>) => Promise<Map<string, string>>
  usergroups: (ids: string[]) => Promise<Map<string, string>>
}

const liveResolvers = (workspace: string): DraftResolvers => ({
  conversation: (id, userNames) => resolveChannelInfo(id, userNames, workspace),
  membership: () => fetchDmMembership(workspace),
  users: (ids) => resolveUserNames(ids, workspace),
  handles: (handles) => resolveHandleNames(handles, workspace),
  channels: (ids, userNames) => resolveChannelNames(ids, userNames, workspace),
  usergroups: (ids) => resolveUsergroupNames(ids, workspace),
})

/**
 * Rows for a page of drafts, in the order given. agent-slack's names are
 * taken as they come; group-DM members come from the boot payload (mpdm
 * slugs are creation-time state), minus self like Slack's own header; the
 * rare unnamed conversation goes through Sky's own lookup. Mentions in the
 * bodies resolve in one bulk call per kind.
 */
export async function resolveDraftRows(
  drafts: SlackDraft[],
  workspace: string,
  timezone: string,
  resolvers: DraftResolvers = liveResolvers(workspace),
): Promise<DraftRow[]> {
  const texts = drafts.map((draft) => normalizeMentions(draft.text))
  const bodies = texts.map((content) => ({ content }))
  const destinations = drafts.map((draft) => draft.destinations[0])
  const kinds = destinations.map(destinationKind)

  const groupIds = unique(destinations.flatMap((d, i) => (kinds[i] === 'group' && d ? [d.channel_id] : [])))
  const membership: DmMembership =
    groupIds.length > 0 ? await resolvers.membership() : { membersByChannel: new Map<string, string[]>() }
  const groupMemberIds = new Map<string, string[]>()
  const slugHandles = new Set<string>()
  for (const id of groupIds) {
    const members = (membership.membersByChannel.get(id) ?? []).filter((member) => member !== membership.selfId)
    if (members.length > 0) groupMemberIds.set(id, members)
    else
      for (const handle of mpdmMemberHandles(destinations.find((d) => d?.channel_id === id)?.channel_name))
        slugHandles.add(handle)
  }

  const userNames = await resolvers.users(unique([...collectUserIds(bodies), ...[...groupMemberIds.values()].flat()]))
  const [handleNames, channelNames, usergroupNames] = await Promise.all([
    resolvers.handles([...slugHandles]),
    resolvers.channels(collectChannelIds(bodies), userNames),
    resolvers.usergroups(collectSubteamIds(bodies)),
  ])

  // Conversations agent-slack returned unnamed — rare, so one lookup each
  const fallback = new Map<string, { kind: DestinationKind; label: string }>()
  for (const id of unique(destinations.flatMap((d) => (d && !d.channel_name ? [d.channel_id] : [])))) {
    const info = await resolvers.conversation(id, userNames)
    if (info.name) fallback.set(id, { kind: info.detectedType ?? 'channel', label: cleanLabel(info) })
  }

  return drafts.map((draft, index) => {
    const destination = destinations[index]
    return {
      draft,
      timeLabel: draft.last_updated_ts ? formatSlackTimestamp(draft.last_updated_ts, timezone) : '',
      link: draftLink(workspace, destination),
      ...destinationLabel(destination, kinds[index], { userNames, handleNames, groupMemberIds, fallback }),
      text: resolveContent(texts[index], userNames, channelNames, usergroupNames),
    }
  })
}

/**
 * Kind from what agent-slack sends: DM ids start with D, group DMs carry an
 * mpdm slug, a named anything else is a channel, and no name at all means
 * agent-slack could not see the conversation.
 */
function destinationKind(destination: SlackDraftDestination | undefined): DestinationKind {
  if (!destination) return 'none'
  if (destination.channel_id.startsWith('D')) return 'dm'
  if (mpdmMemberHandles(destination.channel_name).length > 0) return 'group'
  return destination.channel_name ? 'channel' : 'unknown'
}

type Names = {
  userNames: Map<string, string>
  handleNames: Map<string, string>
  groupMemberIds: Map<string, string[]>
  fallback: Map<string, { kind: DestinationKind; label: string }>
}

/** Person for DMs, members for group DMs, #name for channels; the raw id when nothing could name the conversation. */
function destinationLabel(
  destination: SlackDraftDestination | undefined,
  kind: DestinationKind,
  { userNames, handleNames, groupMemberIds, fallback }: Names,
): { kind: DestinationKind; label: string } {
  if (!destination) return { kind: 'none', label: '(no destination)' }
  const id = destination.channel_id
  switch (kind) {
    case 'dm':
      return { kind, label: destination.channel_name ?? fallback.get(id)?.label ?? id }
    case 'group': {
      const members =
        groupMemberIds.get(id)?.map((member) => userNames.get(member) ?? member) ??
        mpdmMemberHandles(destination.channel_name).map((handle) => handleNames.get(handle) || handle)
      return { kind, label: members.length > 0 ? formatNameList(members) : (destination.channel_name ?? id) }
    }
    case 'channel':
      return { kind, label: `#${destination.channel_name}` }
    default:
      return fallback.get(id) ?? { kind: 'unknown', label: id }
  }
}

/** Sky's conversation lookup names DMs "DM with X"; the row shows the person, like the later listing. */
function cleanLabel(info: ChannelInfo): string {
  const name = info.name ?? ''
  if (info.detectedType === 'channel') return `#${name}`
  return name.replace(/^DM with /, '')
}

/**
 * agent-slack keeps draft mentions in Slack's wire form; resolveContent
 * expects the bare `@U…` its message export uses, and broadcasts as text.
 */
export function normalizeMentions(text: string): string {
  return text
    .replace(/<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/g, '@$1')
    .replace(/<!(here|channel|everyone)(?:\|[^>]*)?>/g, '@$1')
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

const KIND_STYLE: Record<DestinationKind, (label: string) => string> = {
  channel: (label) => colors.bold(colors.cyan(label)),
  dm: (label) => colors.bold(colors.magenta(label)),
  group: (label) => colors.bold(colors.magenta(label)),
  unknown: (label) => colors.red(`⚠ unavailable conversation ${label}`),
  none: (label) => colors.dim(label),
}

export type DraftRowContext = {
  maxSnippet?: number
  /**
   * Render the time as an OSC-8 hyperlink (true) or print the url as a third
   * line (false). Defaults to color support, which is environment-sniffed —
   * tests must pin it.
   */
  hyperlinks?: boolean
}

/**
 * One draft row: a numbered head line (last edit, destination, badges) and a
 * snippet line. The time links to where the draft would post — the thread
 * for a reply, else the conversation — as an OSC-8 hyperlink on a terminal;
 * piped output gets the url as a third line.
 */
export function renderDraftRow(row: DraftRow, index: number, context: DraftRowContext = {}): string[] {
  const hyperlinks = context.hyperlinks ?? colors.isColorSupported
  const label = KIND_STYLE[row.kind](row.label)
  const threadBadge = row.draft.destinations[0]?.thread_ts ? colors.yellow('  ↳ thread reply') : ''
  const scheduledBadge = isScheduled(row.draft) ? colors.green('  scheduled send') : ''
  const files = row.draft.file_ids.length
  const filesBadge = files > 0 ? colors.dim(`  ${files} file${files === 1 ? '' : 's'}`) : ''
  const time = hyperlinks && row.link ? hyperlink(row.timeLabel, row.link) : row.timeLabel
  const snippet = row.text.trim() === '' ? colors.dim('(no text)') : oneLine(row.text, context.maxSnippet ?? 100)
  const lines = [
    `  ${colors.dim(`${String(index + 1).padStart(3)}.`)} ${colors.dim(time)}  ${label}${threadBadge}${scheduledBadge}${filesBadge}`,
    `       ${snippet}`,
  ]
  if (!hyperlinks && row.link) lines.push(`       ${colors.dim(row.link)}`)
  return lines
}
