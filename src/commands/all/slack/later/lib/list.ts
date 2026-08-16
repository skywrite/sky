import colors from 'picocolors'
import parseLaterList from '#commands/all/slack/cli/lib/agent-slack/parseLaterList.ts'
import type { AgentSlackLaterItem, AgentSlackLaterList } from '#commands/all/slack/cli/lib/agent-slack/types.ts'
import { runAgentSlack } from '#commands/all/slack/lib/agentSlack.ts'
import { mpdmMemberHandles } from '#commands/all/slack/lib/mpdmMembers.ts'
import { oneLine } from './pick.ts'

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

/** Conversation label for a later item: person for DMs, member handles for group DMs, #name for channels. */
export function laterChannelLabel(item: AgentSlackLaterItem): string {
  // D-prefixed conversation ids are DMs (person, no #); mpdm slugs list their members
  const isDm = item.channel_id.startsWith('D')
  const name = item.channel_name?.replace(/^#/, '')
  const groupHandles = mpdmMemberHandles(name)
  if (groupHandles.length > 0) return groupHandles.join(', ')
  return name ? (isDm ? name : `#${name}`) : item.channel_id
}

/** Permalink to a later item's origin message. */
export function laterItemLink(workspace: string, item: AgentSlackLaterItem): string {
  return `${workspace}/archives/${item.channel_id}/p${item.ts.replace('.', '')}`
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

/** OSC-8 terminal hyperlink. */
function linkify(text: string, url: string): string {
  return `\u001B]8;;${url}\u0007${text}\u001B]8;;\u0007`
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

export type LaterRowContext = {
  /** Dead-id resolutions from resolveStaleChannels; without one, unnamed rows fall back to the raw id */
  stale?: Map<string, StaleChannelInfo>
  maxSnippet?: number
  /**
   * Render the time as an OSC-8 hyperlink (true) or print the raw url as a
   * third line (false). Defaults to color support so terminals get links and
   * pipes get urls — but the default is environment-sniffed (CI counts as
   * color-capable), so tests must pin it.
   */
  hyperlinks?: boolean
}

/**
 * One queue row: a numbered head line (time, conversation, reply count) and a
 * snippet line. The time is an OSC-8 hyperlink to the message, so no url is
 * printed on a terminal — piped output gets it as a third line. Rows whose
 * conversation id no longer resolves show the twin-inferred name and a stale
 * or duplicate marker instead of a bare id, and rows the export returned
 * bodyless get a labeled placeholder instead of a blank snippet.
 */
export function renderLaterRow(
  row: { item: AgentSlackLaterItem; timeLabel: string; link: string },
  index: number,
  context: LaterRowContext = {},
): string[] {
  const { item, timeLabel, link } = row
  const hyperlinks = context.hyperlinks ?? colors.isColorSupported
  const kind = laterConversationKind(item)
  const staleInfo = kind === 'unknown' ? context.stale?.get(item.channel_id) : undefined
  const duplicate = staleInfo?.duplicateTs.has(item.ts) ?? false

  let label: string
  if (kind !== 'unknown') {
    label = colors.bold(KIND_COLOR[kind](laterChannelLabel(item)))
  } else if (staleInfo?.name) {
    const note = duplicate ? 'duplicate save — stale channel id' : 'stale channel id'
    label = colors.yellow(`#${staleInfo.name}`) + colors.dim(` (${note})`)
  } else {
    label = colors.red(`⚠ unavailable channel ${item.channel_id}`)
  }

  const replies = item.message?.reply_count
  const replyBadge = replies ? colors.dim(`  ↩ ${replies}`) : ''

  const body = item.message ? oneLine(item.message.content ?? '', context.maxSnippet ?? 100) : ''
  const placeholder = duplicate
    ? '(same message as its live twin in this queue)'
    : item.message
      ? '(no text)'
      : '(no preview — message not fetched)'
  const snippet = body === '' ? colors.dim(placeholder) : body

  const lines = [
    `  ${colors.dim(`${String(index + 1).padStart(2)}.`)} ${colors.dim(hyperlinks ? linkify(timeLabel, link) : timeLabel)}  ${label}${replyBadge}`,
    `      ${snippet}`,
  ]
  if (!hyperlinks) lines.push(`      ${link}`)
  return lines
}
