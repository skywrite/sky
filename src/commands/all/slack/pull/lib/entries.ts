import type { AgentSlackMessage } from '#commands/all/slack/cli/lib/agent-slack/types.ts'
import { formatSlackTimestamp, normalizeFences, resolveContent } from '#commands/all/slack/lib/mod.ts'
import { markdownLabel, slackMessageId, type SlackWriteMessage } from '#shared/models/Message/slack/write.ts'
import type { ClockStamps } from './clock.ts'

/** Names for the ids messages mention, as far as they resolved. */
export type SlackNames = {
  users: Map<string, string>
  channels: Map<string, string>
  usergroups: Map<string, string>
}

/** The day a Slack ts falls on in the given timezone, as YYYY-MM-DD. */
export function dayOf(ts: string, timezone: string): string {
  return formatSlackTimestamp(ts, timezone).slice(0, 10)
}

/** Slack's housekeeping subtypes: membership and settings changes, not conversation. */
const HOUSEKEEPING = new Set([
  'channel_join',
  'channel_leave',
  'channel_topic',
  'channel_purpose',
  'channel_name',
  'channel_archive',
  'channel_unarchive',
  'channel_convert_to_private',
  'channel_convert_to_public',
  'group_join',
  'group_leave',
  'group_topic',
  'group_purpose',
  'group_name',
  'group_archive',
  'group_unarchive',
  'bot_add',
  'bot_remove',
  'pinned_item',
  'unpinned_item',
  'joiner_notification_for_inviter',
  'tombstone',
])

export function isHousekeeping(message: { subtype?: string }): boolean {
  return message.subtype !== undefined && HOUSEKEEPING.has(message.subtype)
}

/** True for a reply: a message in a thread that is not the thread's root. */
export function isReply(message: { ts: string; thread_ts?: string }): boolean {
  return message.thread_ts !== undefined && message.thread_ts !== message.ts
}

export function authorOf(message: AgentSlackMessage, names: SlackNames): string {
  const userId = message.author?.user_id
  if (userId) return names.users.get(userId) ?? userId
  const botId = message.author?.bot_id
  return botId ? `bot ${botId}` : '-'
}

/** A reply's root, for the line that places the reply in its thread. */
export type ThreadRoot = { author: string; timestamp: string }

/** The channel and ts behind a cache anchor id (message-slack-<channel>-<seconds>-<micros>). */
export function parseMessageId(id: string): { channelId: string; ts: string } | undefined {
  const match = /^message-slack-([A-Z0-9]+)-(\d+)-(\d+)$/.exec(id)
  return match ? { channelId: match[1], ts: `${match[2]}.${match[3]}` } : undefined
}

/** What a message's clock line says: the system's wall clock with its zone, and the moment in UTC. */
export type ClockLine = { system: string; zone: string; utc: string }

const CLOCK_LINE = /^\*(\d{4}-\d{2}-\d{2} \d{2}:\d{2}) (\S+) · (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) UTC\*$/

/**
 * The line under a message's heading that carries its other two clocks. The
 * heading is the notebook's time; a reader who needs the moment itself, or
 * the system's wall clock when the message was pulled, finds them here.
 */
function clockLine(stamps: ClockStamps): string {
  return `*${stamps.system} ${stamps.zone} · ${stamps.utc} UTC*`
}

/** What a reply's thread line says: the root's anchor id always, its author and time when the root was in reach. */
export type ThreadLine = { rootId: string; author?: string; timestamp?: string }

const THREAD_LINE =
  /^↳ \*(?:in the thread of \[(.+), (\d{4}-\d{2}-\d{2} \d{2}:\d{2})\]|in \[a thread\])\(#(message-slack-[A-Z0-9]+-\d+-\d+)\)\*$/

/**
 * The line that places a reply in its thread. It links the root's anchor id,
 * so the thread can be assembled from the cache alone, and names the root's
 * author and time when the root was in reach.
 */
function threadLine(rootId: string, root: ThreadRoot | undefined): string {
  const label = root ? `in the thread of [${markdownLabel(root.author)}, ${root.timestamp}]` : 'in [a thread]'
  return `↳ *${label}(#${rootId})*`
}

function unescapeLabel(label: string): string {
  return label.replace(/\\([\\[\]*_`<>#])/g, '$1')
}

/** A cache text taken apart: its clock line and thread line when present, and the message itself. */
export type CacheLines = { clock?: ClockLine; thread?: ThreadLine; body: string }

function nextLine(lines: string[], at: number): number {
  let next = at
  while (next < lines.length && lines[next].trim() === '') next++
  return next
}

/** Take a cache text apart: the clock line first, the thread line next, each optional, then the message. */
export function parseCacheLines(text: string): CacheLines {
  const lines = text.trimStart().split('\n')
  let at = 0
  const clockMatch = CLOCK_LINE.exec(lines[at] ?? '')
  const clock = clockMatch ? { system: clockMatch[1], zone: clockMatch[2], utc: clockMatch[3] } : undefined
  if (clockMatch) at = nextLine(lines, at + 1)
  const threadMatch = THREAD_LINE.exec(lines[at] ?? '')
  const thread = threadMatch
    ? {
        rootId: threadMatch[3],
        ...(threadMatch[1] === undefined ? {} : { author: unescapeLabel(threadMatch[1]), timestamp: threadMatch[2] }),
      }
    : undefined
  if (threadMatch) at = nextLine(lines, at + 1)
  return { ...(clock ? { clock } : {}), ...(thread ? { thread } : {}), body: lines.slice(at).join('\n').trim() }
}

/** Read a reply's thread line back from its cache text; nothing for a root or a lone message. */
export function parseThreadLine(text: string): ThreadLine | undefined {
  return parseCacheLines(text).thread
}

/** One cache entry: who, when on all three clocks, what, and the thread it answers in. */
export function toCacheEntry(
  message: AgentSlackMessage,
  input: { stamps: ClockStamps; names: SlackNames; root?: ThreadRoot },
): SlackWriteMessage {
  const parts: string[] = [clockLine(input.stamps)]
  const rootTs = isReply(message) ? message.thread_ts : undefined
  if (rootTs) parts.push(threadLine(slackMessageId(message.channel_id, rootTs), input.root))
  const content = message.content?.trim()
  if (content) {
    parts.push(
      normalizeFences(resolveContent(content, input.names.users, input.names.channels, input.names.usergroups)),
    )
  }
  for (const file of message.files ?? []) {
    const name = markdownLabel(file.name ?? 'file')
    parts.push(`*Attached: ${name}${file.mimetype ? ` (${file.mimetype})` : ''}*`)
  }
  return {
    id: slackMessageId(message.channel_id, message.ts),
    timestamp: input.stamps.notebook,
    author: authorOf(message, input.names),
    text: parts.join('\n\n'),
  }
}
