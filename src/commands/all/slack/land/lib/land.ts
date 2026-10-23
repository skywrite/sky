import parseMessageLink from '#commands/all/slack/lib/parseMessageLink.ts'
import { compareTs, justBefore, toTs } from '#commands/all/slack/pull/lib/ts.ts'
import type { SlackForYou } from '#shared/config/types.ts'
import type { ActivityEntry, OwnMessage } from './feed.ts'
import { messageLink } from './links.ts'
import { LAND_RUNS_KEPT, type LandRun, type LandState } from './state.ts'

export type ThreadOutcome =
  | { status: 'landed'; docs: number }
  /** Already in the notebook, nothing new */
  | { status: 'known' }
  /** Deleted, or in a channel Sky cannot read */
  | { status: 'gone' }
  | { status: 'failed'; message: string }

export type ConversationOutcome =
  | { status: 'landed'; messages: number; docs: number }
  | { status: 'failed'; message: string }

export type ConversationKind = 'dm' | 'group' | 'channel'

/** What the landing needs from the world. The command wires Slack and the notebook in; tests wire fakes. */
export type LandHost = {
  workspace: string
  nowSeconds: number
  /** Local date-time of the pass, for its record */
  stamp: string
  rules: SlackForYou
  log: (line: string) => void
  signal?: AbortSignal
  readState: () => Promise<LandState>
  writeState: (state: LandState) => Promise<void>
  /** Activity newer than a ts, of Slack's given types, oldest first */
  feed: (since: string, types: readonly string[]) => Promise<ActivityEntry[]>
  /** The owner's own messages newer than a ts */
  own: (since: string) => Promise<OwnMessage[]>
  kindOf: (channelId: string) => Promise<ConversationKind>
  /** Capture a thread into the day, or bring its capture up to date */
  captureThread: (link: string) => Promise<ThreadOutcome>
  /** Land a direct or group conversation's messages newer than a ts into the day */
  landConversation: (channelId: string, kind: 'dm' | 'group', since: string) => Promise<ConversationOutcome>
}

export type LandOptions = {
  /** How far back the first pass looks */
  backfillDays: number
  /** Say what would land and stop */
  dryRun?: boolean
}

export const LAND_DEFAULTS: LandOptions = { backfillDays: 7 }

type Planned = { why: string; feedAt?: string; ownAt?: string }
type PlannedThread = Planned & { link: string }
type PlannedConversation = Planned & { id: string; kind: 'dm' | 'group' }

export type LandPlan = { threads: PlannedThread[]; conversations: PlannedConversation[] }

export type LandResult = {
  dryRun: boolean
  plan: LandPlan
  threads: { link: string; outcome: ThreadOutcome }[]
  conversations: { id: string; outcome: ConversationOutcome }[]
  /** Day documents written or changed */
  docs: number
  /** Threads already in the notebook with nothing new */
  known: number
  errors: string[]
}

/** Slack's entry types behind each For you rule. Group pings (@channel, @here, a user group) are not a mention of you. */
const MENTION_TYPES = ['at_user', 'keyword']
const REPLY_TYPES = ['thread_v2']
const DM_TYPES = ['dm']

const newest = (values: readonly string[]): string | undefined =>
  values.reduce<string | undefined>(
    (max, value) => (max === undefined || compareTs(value, max) > 0 ? value : max),
    undefined,
  )

/** What the feed and the owner's own messages say should land, each thread and conversation once. */
export async function planLanding(
  host: Pick<LandHost, 'workspace' | 'rules' | 'kindOf'>,
  entries: readonly ActivityEntry[],
  own: readonly OwnMessage[],
): Promise<LandPlan> {
  const threads = new Map<string, PlannedThread>()
  const conversations = new Map<string, PlannedConversation>()
  for (const entry of entries) {
    if (!entry.channel_id) continue
    if (entry.type === 'dm') {
      const kind = (await host.kindOf(entry.channel_id)) === 'group' ? 'group' : 'dm'
      const known = conversations.get(entry.channel_id)
      if (known) known.feedAt = known.feedAt ?? entry.feed_ts
      else
        conversations.set(entry.channel_id, {
          id: entry.channel_id,
          kind,
          why: 'a direct message',
          feedAt: entry.feed_ts,
        })
      continue
    }
    const ts = entry.ts ?? entry.thread_ts
    if (!ts) continue
    const root = entry.thread_ts ?? ts
    const key = `${entry.channel_id}:${root}`
    const known = threads.get(key)
    if (known) {
      known.feedAt = known.feedAt ?? entry.feed_ts
      continue
    }
    const reply = entry.type === 'thread_v2'
    threads.set(key, {
      link: reply
        ? messageLink(host.workspace, entry.channel_id, root)
        : messageLink(host.workspace, entry.channel_id, ts, entry.thread_ts),
      why: reply ? 'a reply in your thread' : 'a mention',
      feedAt: entry.feed_ts,
    })
  }
  for (const message of own) {
    const kind = await host.kindOf(message.channel_id)
    if (kind !== 'channel') {
      const known = conversations.get(message.channel_id)
      if (known) known.ownAt = known.ownAt ?? message.ts
      else
        conversations.set(message.channel_id, {
          id: message.channel_id,
          kind,
          why: 'your own message',
          ownAt: message.ts,
        })
      continue
    }
    const root = (message.permalink ? parseMessageLink(message.permalink) : undefined)?.rootTs ?? message.ts
    const key = `${message.channel_id}:${root}`
    const known = threads.get(key)
    if (known) {
      known.ownAt = known.ownAt ?? message.ts
      continue
    }
    threads.set(key, {
      link: message.permalink ?? messageLink(host.workspace, message.channel_id, message.ts),
      why: 'your own message',
      ownAt: message.ts,
    })
  }
  return { threads: [...threads.values()], conversations: [...conversations.values()] }
}

/**
 * One landing pass: what Slack's Activity view and the owner's own messages
 * say happened since the last pass, landed into the day as the conversations
 * they belong to. A failure holds the cursor just before the entry that
 * failed, so the next pass tries it again; everything after it was handled
 * and answers "known" the second time.
 */
export async function landActivity(host: LandHost, options: LandOptions = LAND_DEFAULTS): Promise<LandResult> {
  const started = performance.now()
  const state = await host.readState()
  const backfill = toTs(host.nowSeconds - options.backfillDays * 86400)
  const feedSince = state.feedCursor ?? backfill
  const ownSince = state.ownCursor ?? backfill
  const types = [
    ...(host.rules.mentions ? [...MENTION_TYPES, ...REPLY_TYPES] : []),
    ...(host.rules.dms ? DM_TYPES : []),
  ]
  const entries = types.length > 0 ? await host.feed(feedSince, types) : []
  const own = host.rules.own
    ? (await host.own(ownSince))
        .filter((message) => compareTs(message.ts, ownSince) > 0)
        .sort((a, b) => compareTs(a.ts, b.ts))
    : []
  const plan = await planLanding(host, entries, own)
  const result: LandResult = {
    dryRun: Boolean(options.dryRun),
    plan,
    threads: [],
    conversations: [],
    docs: 0,
    known: 0,
    errors: [],
  }
  if (options.dryRun) return result

  const failedFeed: string[] = []
  const failedOwn: string[] = []
  const failed = (planned: Planned, message: string) => {
    result.errors.push(message)
    if (planned.feedAt) failedFeed.push(planned.feedAt)
    if (planned.ownAt) failedOwn.push(planned.ownAt)
  }
  for (const conversation of plan.conversations) {
    if (host.signal?.aborted) break
    // The conversation's own record knows how far it got; the pass only says it moved
    const outcome = await host.landConversation(conversation.id, conversation.kind, feedSince)
    result.conversations.push({ id: conversation.id, outcome })
    if (outcome.status === 'failed') failed(conversation, `${conversation.id}: ${outcome.message}`)
    else {
      result.docs += outcome.docs
      if (outcome.messages > 0)
        host.log(`[land] ${conversation.id}: ${outcome.messages} message(s) in ${outcome.docs} document(s)`)
    }
  }
  for (const thread of plan.threads) {
    if (host.signal?.aborted) break
    const outcome = await host.captureThread(thread.link)
    result.threads.push({ link: thread.link, outcome })
    if (outcome.status === 'failed') failed(thread, `${thread.link}: ${outcome.message}`)
    else if (outcome.status === 'known') result.known++
    else if (outcome.status === 'landed') {
      result.docs += outcome.docs
      host.log(`[land] ${thread.why}: ${outcome.docs} document(s) — ${thread.link}`)
    }
  }

  const earliestFailed = (values: string[]) =>
    values.reduce<string | undefined>(
      (min, value) => (min === undefined || compareTs(value, min) < 0 ? value : min),
      undefined,
    )
  const feedFailure = earliestFailed(failedFeed)
  const ownFailure = earliestFailed(failedOwn)
  const run: LandRun = {
    at: host.stamp,
    threads: result.threads.filter((thread) => thread.outcome.status === 'landed').length,
    conversations: result.conversations.filter(
      (conversation) => conversation.outcome.status === 'landed' && conversation.outcome.messages > 0,
    ).length,
    docs: result.docs,
    known: result.known,
    errors: result.errors.length,
    seconds: Math.round((performance.now() - started) / 1000),
  }
  await host.writeState({
    feedCursor: feedFailure
      ? justBefore(feedFailure)
      : (newest(entries.map((entry) => entry.feed_ts)) ?? state.feedCursor ?? toTs(host.nowSeconds)),
    ownCursor: ownFailure
      ? justBefore(ownFailure)
      : (newest(own.map((message) => message.ts)) ?? state.ownCursor ?? toTs(host.nowSeconds)),
    runs: [run, ...state.runs].slice(0, LAND_RUNS_KEPT),
  })
  return result
}
