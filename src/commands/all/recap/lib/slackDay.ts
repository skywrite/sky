import type { CacheMessage } from '#commands/all/slack/pull/lib/cache.ts'
import { type ChannelDayView, readNotebookDay, utcDaysOf } from '#commands/all/slack/pull/lib/dayView.ts'
import { dayOf, parseMessageId } from '#commands/all/slack/pull/lib/entries.ts'
import { assembleThread, type CachedThread, readChannelDays } from '#commands/all/slack/pull/lib/thread.ts'
import { Document } from '#shared/models/Markdown/mod.ts'
import { markdownLabel, updateSlackConversation } from '#shared/models/Message/slack/write.ts'

/** What a Slack document is to the model: a channel's day, or the earlier part of a thread replied to that day. */
export type SlackDocKind = 'channel' | 'thread'

export interface SlackDocEntry {
  doc: Document
  /** `<root>/<day>/<channel>` for a channel's day; the root's day and id as the fragment for a thread. A name, not a file. */
  path: string
  kind: SlackDocKind
  /** The notebook day the messages are from: the day itself for a channel, the root's day for a thread. */
  day: string
  /** Messages shipped in the document. */
  messages: number
  /** A thread's root, by its cache id. */
  rootId?: string
}

export interface SlackDayDocs {
  /** The day's channels, by name. */
  channels: SlackDocEntry[]
  /** For every thread replied to that day whose root sits on an earlier day: the root and the replies before the day. */
  threads: SlackDocEntry[]
  /** Channel messages on the day, all channels together. */
  messages: number
  /** The notebook times of the day's first and last channel message. */
  span?: { first: string; last: string }
}

/**
 * One notebook day's Slack channels from the channel cache, model-ready.
 *
 * The cache is partitioned by UTC day; the day view (`pull/lib/dayView.ts`)
 * assembles the notebook day from it. Each channel ships as one document
 * in the cache files' own shape. Most of a busy day's traffic is thread
 * replies, and a reply read alone is an answer without its question: for
 * every reply whose root sits on an earlier notebook day, the root and the
 * replies before the day ship as a THREAD document. Replies after the day
 * never ship, and a root older than the cache with no earlier replies adds
 * nothing.
 */
export default async function gatherSlackDay(input: {
  root: string
  day: string
  muted?: ReadonlySet<string>
}): Promise<SlackDayDocs> {
  const views = await readNotebookDay(input.root, input.day, input.muted)
  const channels = views.map(
    (view): SlackDocEntry => ({
      doc: channelDocument(view, input.day),
      path: `${input.root}/${input.day}/${view.fileName}`,
      kind: 'channel',
      day: input.day,
      messages: view.messages.length,
    }),
  )
  const threads: SlackDocEntry[] = []
  for (const view of views) threads.push(...(await earlierThreads(input, view)))
  const stamps = views.flatMap((view) => view.messages.map((message) => message.timestamp)).sort()
  return {
    channels,
    threads,
    messages: stamps.length,
    ...(stamps.length > 0 ? { span: { first: stamps[0], last: stamps[stamps.length - 1] } } : {}),
  }
}

const ANCHOR = /<a id="(message-slack-[A-Z0-9]+-\d+-\d+)">/g
// A Slack permalink: the message's channel and ts, and for a reply's link the root's ts after it.
const PERMALINK = /\/archives\/([A-Z0-9]+)\/p(\d{10})(\d{6})\b(?:\?[^\s"<>)]*?thread_ts=(\d{10})\.(\d{6}))?/g

/**
 * The roots of the threads a day's captures hold, by cache id. A capture
 * carries the anchors of the messages it holds, and its `link:` names the
 * message it was captured from: the root, or a reply whose link carries
 * the root's ts. A thread captured over several days keeps the root's
 * anchor in its first day's document only, so the link is what names the
 * thread on every later day.
 */
export function capturedRoots(captures: readonly string[]): Set<string> {
  const ids = new Set<string>()
  for (const markdown of captures) {
    for (const match of markdown.matchAll(ANCHOR)) ids.add(match[1])
    for (const [, channel, seconds, micros, rootSeconds, rootMicros] of markdown.matchAll(PERMALINK)) {
      ids.add(
        rootSeconds
          ? `message-slack-${channel}-${rootSeconds}-${rootMicros}`
          : `message-slack-${channel}-${seconds}-${micros}`,
      )
    }
  }
  return ids
}

/**
 * Split the threads into the ones the notebook already holds and the rest.
 * A thread the owner took part in lands in the day directory as a capture;
 * shipping the cache's copy too would hand the model one conversation
 * twice, so a thread whose root one of the day's captures names is left to
 * the capture.
 */
export function dropCapturedThreads(
  threads: readonly SlackDocEntry[],
  captures: readonly string[],
): { kept: SlackDocEntry[]; captured: SlackDocEntry[] } {
  const roots = capturedRoots(captures)
  const kept: SlackDocEntry[] = []
  const captured: SlackDocEntry[] = []
  for (const thread of threads) (thread.rootId && roots.has(thread.rootId) ? captured : kept).push(thread)
  return { kept, captured }
}

function channelDocument(view: ChannelDayView, day: string): Document {
  const markdown = updateSlackConversation(
    `# #${view.channel} · ${day}\n\n## Conversation\n\n`,
    view.messages.map(({ id, timestamp, author, text }) => ({ id, timestamp, author, text })),
  )
  return new Document(
    { channel: `#${view.channel}`, ...(view.channelId ? { channel_id: view.channelId } : {}), day },
    markdown,
  )
}

/** One THREAD document per root the day's replies point at that is not among the day's own messages. */
async function earlierThreads(input: { root: string; day: string }, view: ChannelDayView): Promise<SlackDocEntry[]> {
  const own = new Set(view.messages.map((message) => message.id))
  const roots = new Map<string, string>()
  for (const message of view.messages) {
    const rootId = message.thread?.rootId
    if (!rootId || own.has(rootId) || roots.has(rootId)) continue
    const identity = parseMessageId(rootId)
    if (identity) roots.set(rootId, dayOf(identity.ts, 'UTC'))
  }
  if (roots.size === 0) return []
  const earliest = [...roots.values()].sort()[0]
  const latest = utcDaysOf(input.day).at(-1)
  const earlier = (await readChannelDays(input.root, view.fileName, earliest, latest)).filter(
    (message) => message.timestamp.slice(0, 10) < input.day,
  )
  const threads: SlackDocEntry[] = []
  for (const [rootId, rootUtcDay] of roots) {
    const thread = assembleThread(earlier, rootId)
    const shipped = [...(thread.root ? [thread.root] : []), ...thread.replies]
    if (shipped.length === 0) continue
    const day = thread.root ? thread.root.timestamp.slice(0, 10) : rootUtcDay
    threads.push({
      doc: threadDocument(view.channel, rootId, thread, shipped),
      path: `${input.root}/${day}/${view.fileName}#${rootId}`,
      kind: 'thread',
      day,
      messages: shipped.length,
      rootId,
    })
  }
  return threads
}

/** The thread in the channel files' own shape, titled by its root so the day's thread lines read against it. */
function threadDocument(channel: string, rootId: string, thread: CachedThread, messages: CacheMessage[]): Document {
  const title = thread.root
    ? `the thread of ${markdownLabel(thread.root.author)}, ${thread.root.timestamp}`
    : 'a thread whose root is older than the cache'
  const markdown = updateSlackConversation(
    `# #${channel} · ${title}\n\n## Conversation\n\n`,
    messages.map(({ id, timestamp, author, text }) => ({ id, timestamp, author, text })),
  )
  return new Document({ channel: `#${channel}`, thread: rootId }, markdown)
}
