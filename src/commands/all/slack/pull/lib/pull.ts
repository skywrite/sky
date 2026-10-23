import type { AgentSlackConversationCount, AgentSlackMessage } from '#commands/all/slack/cli/lib/agent-slack/types.ts'
import { formatSlackTimestamp } from '#commands/all/slack/lib/mod.ts'
import type { SlackWriteMessage } from '#shared/models/Message/slack/write.ts'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import type { Clock } from './clock.ts'
import { authorOf, dayOf, isHousekeeping, isReply, toCacheEntry, type SlackNames, type ThreadRoot } from './entries.ts'
import { type PulledChannel, type PullRun, type Roster, RUNS_KEPT } from './roster.ts'
import type { SlackRules } from './rules.ts'
import { compareTs, toTs } from './ts.ts'

/** What the pull needs from the world. The command wires Slack and the state files in; tests wire fakes. */
export type PullHost = {
  /** The moment of the pull, in epoch seconds */
  now: number
  /** The system's zone: the roster's stamps and every message's system clock */
  timezone: string
  /** The three clocks of a moment: notebook, system and UTC */
  clock: Clock
  log: (line: string) => void
  signal?: AbortSignal
  /** Every joined conversation, with the ts of its newest channel message */
  counts: () => Promise<AgentSlackConversationCount[]>
  /** Names for channel ids the roster does not know yet */
  channelNames: (ids: string[]) => Promise<Map<string, string>>
  /** Channel messages newer than `oldest`, every page, oldest first */
  history: (channelId: string, oldest: string) => Promise<AgentSlackMessage[]>
  /** A thread's root and every reply, oldest first */
  thread: (channelId: string, threadTs: string) => Promise<AgentSlackMessage[]>
  /** Names for the people, channels and groups these messages mention */
  names: (messages: AgentSlackMessage[]) => Promise<SlackNames>
  readRoster: () => Promise<Roster>
  writeRoster: (roster: Roster) => Promise<void>
  /** The person's choices: the channels to leave out */
  readRules: () => Promise<SlackRules>
  /** Add entries to one channel's day file; says how many were new and which were kept inside a code fence */
  append: (
    channel: PulledChannel,
    day: string,
    entries: SlackWriteMessage[],
  ) => Promise<{ added: number; fenced: string[] }>
}

export type PullOptions = {
  /** How far back a channel's first read goes, and how far a deep read re-reads for late replies */
  backfillDays: number
  /** How far back every read re-reads channel messages to notice new thread replies */
  replyWindowHours: number
  /** How often a channel gets a deep read */
  deepEveryHours: number
  /** Only the channel with this name or id */
  only?: string
  /** Stop after this many channels, freshest first */
  max?: number
}

export const PULL_DEFAULTS: PullOptions = { backfillDays: 7, replyWindowHours: 48, deepEveryHours: 24 }

export type PulledChannelReport = {
  id: string
  name: string
  /** Messages new to the cache, thread replies included */
  added: number
  /** Threads read for new replies */
  threads: number
  /** Messages whose text had to be kept inside a code fence to stay one message */
  fenced: number
  days: string[]
  /** The channel's first read, which went backfillDays back */
  backfilled: boolean
}

export type PullResult = {
  /** Joined channels, after the roster update */
  joined: number
  pulled: PulledChannelReport[]
  /** Channels with nothing new since their cursor */
  unchanged: number
  /** Muted channels, left out; their cursor follows the channel so unmuting resumes from now */
  muted: number
  /** Channels whose read failed; their cursor is untouched and they retry next pull */
  errors: { id: string; name: string; message: string }[]
}

function hoursSince(stamp: string | undefined, now: PlainDateTime): number {
  if (!stamp) return Infinity
  return new PlainDateTime(stamp).until(now).total('hours')
}

/** `--channel` matches a channel by name (with or without #) or by id. */
export function matchesChannel(channel: { id: string; name: string }, only: string | undefined): boolean {
  if (!only) return true
  const wanted = only.trim().replace(/^#/, '').toLowerCase()
  return channel.id.toLowerCase() === wanted || channel.name.toLowerCase() === wanted
}

/** Pull every joined channel's new messages into the cache and advance each channel's cursor. */
export async function pullChannels(host: PullHost, options: PullOptions = PULL_DEFAULTS): Promise<PullResult> {
  const counts = (await host.counts()).filter((entry) => entry.type === 'channel')
  const roster = await host.readRoster()
  const known = new Map(roster.channels.map((channel) => [channel.id, channel]))
  const unknown = counts.filter((entry) => !known.has(entry.id)).map((entry) => entry.id)
  if (unknown.length > 0) {
    const names = await host.channelNames(unknown)
    for (const id of unknown) {
      const channel: PulledChannel = { id, name: names.get(id) ?? id }
      roster.channels.push(channel)
      known.set(id, channel)
    }
    await host.writeRoster(roster)
  }

  const rules = await host.readRules()
  const muted = new Set(rules.muted)
  const started = performance.now()
  const stamp = formatSlackTimestamp(toTs(host.now), host.timezone)
  const nowLocal = new PlainDateTime(stamp)
  const result: PullResult = { joined: counts.length, pulled: [], unchanged: 0, muted: 0, errors: [] }
  const queue = counts
    .filter((entry) => matchesChannel(known.get(entry.id)!, options.only))
    .sort((a, b) => compareTs(b.latest ?? '0', a.latest ?? '0'))
    .slice(0, options.max ?? counts.length)

  for (const entry of queue) {
    if (host.signal?.aborted) break
    const channel = known.get(entry.id)!
    if (muted.has(channel.id)) {
      // Left out, but the cursor keeps up with the channel: unmuting resumes from now, not from the day it was muted
      if (entry.latest && (!channel.cursor || compareTs(entry.latest, channel.cursor) > 0))
        channel.cursor = entry.latest
      result.muted++
      continue
    }
    const deep = !channel.cursor || hoursSince(channel.deepPulledAt, nowLocal) >= options.deepEveryHours
    const window = host.now - (deep ? options.backfillDays * 86400 : options.replyWindowHours * 3600)
    const windowTs = toTs(window)
    const oldest = channel.cursor && compareTs(channel.cursor, windowTs) < 0 ? channel.cursor : windowTs
    // Nothing newer than the cursor, and no root inside the window that could have gained a reply
    const quiet =
      channel.cursor !== undefined &&
      entry.latest !== undefined &&
      compareTs(entry.latest, channel.cursor) <= 0 &&
      compareTs(entry.latest, windowTs) < 0
    if (quiet) {
      result.unchanged++
      continue
    }
    try {
      const report = await pullChannel(host, { channel, oldest, backfilled: !channel.cursor })
      channel.pulledAt = stamp
      if (deep) channel.deepPulledAt = stamp
      await host.writeRoster(roster)
      result.pulled.push(report)
      if (report.added > 0) {
        const threads = report.threads > 0 ? `, ${report.threads} thread(s)` : ''
        const first = report.backfilled ? ', first read' : ''
        const fenced = report.fenced > 0 ? `, ${report.fenced} kept as code` : ''
        host.log(`[pull] #${channel.name}: ${report.added} new${threads}${first}${fenced}`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      result.errors.push({ id: channel.id, name: channel.name, message })
      host.log(`[pull] #${channel.name}: ${message}`)
    }
  }
  // A full pull is one of Sky's checks, and the page shows the last few; a pull narrowed by
  // --channel or --max is not. The write also lands the cursors of muted channels.
  if (!options.only && options.max === undefined) {
    const run: PullRun = {
      at: stamp,
      added: result.pulled.reduce((sum, channel) => sum + channel.added, 0),
      channels: result.pulled.filter((channel) => channel.added > 0).length,
      threads: result.pulled.reduce((sum, channel) => sum + channel.threads, 0),
      read: result.pulled.length,
      unchanged: result.unchanged,
      muted: result.muted,
      errors: result.errors.length,
      seconds: Math.round((performance.now() - started) / 1000),
    }
    roster.runs = [run, ...roster.runs].slice(0, RUNS_KEPT)
    await host.writeRoster(roster)
  }
  return result
}

/** Read one channel since `oldest`, write what is new, and move its cursor past everything seen. */
async function pullChannel(
  host: PullHost,
  input: { channel: PulledChannel; oldest: string; backfilled: boolean },
): Promise<PulledChannelReport> {
  const { channel } = input
  const { cursor } = channel
  const isNew = (message: { ts: string }): boolean => cursor === undefined || compareTs(message.ts, cursor) > 0

  const history = await host.history(channel.id, input.oldest)
  const roots = new Map<string, AgentSlackMessage>(history.map((message) => [message.ts, message]))
  const seen: AgentSlackMessage[] = history.filter(isNew)
  let threads = 0
  for (const root of history) {
    if (!root.latest_reply || !isNew({ ts: root.latest_reply })) continue
    threads++
    const thread = await host.thread(channel.id, root.ts)
    for (const message of thread) {
      if (message.ts === root.ts) roots.set(root.ts, message)
      else if (isNew(message)) seen.push(message)
    }
  }

  // A broadcast reply is in the channel history and in its thread; keep one
  const unique = [...new Map(seen.map((message) => [message.ts, message])).values()]
    .filter((message) => !isHousekeeping(message))
    .sort((a, b) => compareTs(a.ts, b.ts))
  const names = await host.names([...unique, ...roots.values()])
  const rootOf = async (message: AgentSlackMessage): Promise<ThreadRoot | undefined> => {
    const root = isReply(message) && message.thread_ts ? roots.get(message.thread_ts) : undefined
    return root ? { author: authorOf(root, names), timestamp: (await host.clock(root.ts)).notebook } : undefined
  }

  // Files are by UTC day: a partition that never moves with the system's zone or the
  // notebook's day boundary. Each entry carries its notebook day on its heading.
  const byDay = new Map<string, SlackWriteMessage[]>()
  for (const message of unique) {
    const day = dayOf(message.ts, 'UTC')
    const entries = byDay.get(day) ?? []
    entries.push(toCacheEntry(message, { stamps: await host.clock(message.ts), names, root: await rootOf(message) }))
    byDay.set(day, entries)
  }
  let added = 0
  let fenced = 0
  const days = [...byDay.keys()].sort()
  for (const day of days) {
    const written = await host.append(channel, day, byDay.get(day)!)
    added += written.added
    fenced += written.fenced.length
  }

  // Housekeeping messages count too: the cursor must pass them or they would be read every time.
  // A first read that found nothing still leaves a cursor, at the window's start, or the channel
  // would be read whole again on every pull until someone posts in it.
  const newest = seen.reduce<string | undefined>(
    (max, message) => (max === undefined || compareTs(message.ts, max) > 0 ? message.ts : max),
    cursor,
  )
  channel.cursor = newest ?? input.oldest
  return { id: channel.id, name: channel.name, added, threads, fenced, days, backfilled: input.backfilled }
}
