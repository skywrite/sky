import { assert, test } from '#test'
import type { ActivityEntry, OwnMessage } from './feed.ts'
import { type ConversationOutcome, LAND_DEFAULTS, landActivity, type LandHost, type ThreadOutcome } from './land.ts'
import type { LandState } from './state.ts'

/** 2025-10-09 08:53:20 UTC */
const NOW = 1760000000
const WEEK_AGO = '1759395200.000000'
const WS = 'https://atlas.slack.com'

type Fake = { host: LandHost; calls: string[]; state: LandState | undefined; logs: string[] }

function fake(input: {
  state?: LandState
  entries?: ActivityEntry[]
  own?: OwnMessage[]
  rules?: LandHost['rules']
  kinds?: Record<string, 'dm' | 'group' | 'channel'>
  thread?: (link: string) => ThreadOutcome
  conversation?: (id: string) => ConversationOutcome
}): Fake {
  const state = { state: input.state, calls: [] as string[], logs: [] as string[] }
  const host: LandHost = {
    workspace: WS,
    nowSeconds: NOW,
    stamp: '2025-10-09 08:53',
    rules: input.rules ?? { dms: true, mentions: true, own: true },
    log: (line) => state.logs.push(line),
    readState: async () => state.state ?? { runs: [] },
    writeState: async (next) => {
      state.calls.push('write state')
      state.state = next
    },
    feed: async (since, types) => {
      state.calls.push(`feed ${since} ${types.join(',')}`)
      return input.entries ?? []
    },
    own: async (since) => {
      state.calls.push(`own ${since}`)
      return input.own ?? []
    },
    kindOf: async (id) => input.kinds?.[id] ?? (id.startsWith('D') ? 'dm' : 'channel'),
    captureThread: async (link) => {
      state.calls.push(`thread ${link}`)
      return input.thread?.(link) ?? { status: 'landed', docs: 1 }
    },
    landConversation: async (id, kind, since) => {
      state.calls.push(`conversation ${id} ${kind} ${since}`)
      return input.conversation?.(id) ?? { status: 'landed', messages: 2, docs: 1 }
    },
  }
  return {
    host,
    calls: state.calls,
    logs: state.logs,
    get state() {
      return state.state
    },
  }
}

const entries: ActivityEntry[] = [
  { type: 'dm', feed_ts: '1759900000.000100', channel_id: 'D0JANE', ts: '1759900000.000100' },
  {
    type: 'at_user',
    feed_ts: '1759910000.000100',
    channel_id: 'C0ATLAS',
    ts: '1759910000.000100',
    thread_ts: '1759905000.000100',
  },
  {
    type: 'thread_v2',
    feed_ts: '1759920000.000100',
    channel_id: 'C0ATLAS',
    ts: '1759920000.000100',
    thread_ts: '1759905000.000100',
  },
  {
    type: 'thread_v2',
    feed_ts: '1759930000.000100',
    channel_id: 'C0DESIGN',
    ts: '1759930000.000100',
    thread_ts: '1759925000.000100',
  },
  { type: 'dm', feed_ts: '1759940000.000100', channel_id: 'D0JANE', ts: '1759940000.000100' },
  { type: 'dm', feed_ts: '1759950000.000100', channel_id: 'G0TEAM', ts: '1759950000.000100' },
  { type: 'at_user', feed_ts: '1759960000.000100', channel_id: 'C0ATLAS', ts: '1759960000.000100' },
]
const own: OwnMessage[] = [
  { channel_id: 'D0JANE', ts: '1759945000.000100', permalink: `${WS}/archives/D0JANE/p1759945000000100` },
  {
    channel_id: 'C0DESIGN',
    ts: '1759935000.000100',
    permalink: `${WS}/archives/C0DESIGN/p1759935000000100?thread_ts=1759925000.000100&cid=C0DESIGN`,
  },
  { channel_id: 'C0OPS', ts: '1759970000.000100', permalink: `${WS}/archives/C0OPS/p1759970000000100` },
  { channel_id: 'C0OPS', ts: '1759000000.000100', permalink: `${WS}/archives/C0OPS/p1759000000000100` },
]

test('a pass lands each conversation and thread once, from the feed and your own messages, and moves both cursors', async () => {
  const f = fake({ entries, own, kinds: { G0TEAM: 'group' } })
  const result = await landActivity(f.host)
  assert({
    given: 'a first pass over a week of activity',
    should: 'ask a week back, land two conversations and three threads, each once, and record the pass',
    actual: [f.calls, result.docs, result.known, result.errors],
    expected: [
      [
        `feed ${WEEK_AGO} at_user,keyword,thread_v2,dm`,
        `own ${WEEK_AGO}`,
        `conversation D0JANE dm ${WEEK_AGO}`,
        `conversation G0TEAM group ${WEEK_AGO}`,
        `thread ${WS}/archives/C0ATLAS/p1759910000000100?thread_ts=1759905000.000100&cid=C0ATLAS`,
        `thread ${WS}/archives/C0DESIGN/p1759925000000100`,
        `thread ${WS}/archives/C0ATLAS/p1759960000000100`,
        `thread ${WS}/archives/C0OPS/p1759970000000100`,
        'write state',
      ],
      6,
      0,
      [],
    ],
  })
  assert({
    given: 'the state afterwards',
    should: 'sit at the newest activity and the newest own message, with the pass on record',
    actual: f.state,
    expected: {
      feedCursor: '1759960000.000100',
      ownCursor: '1759970000.000100',
      runs: [{ at: '2025-10-09 08:53', threads: 4, conversations: 2, docs: 6, known: 0, errors: 0, seconds: 0 }],
    },
  })
  assert({
    given: 'the plan',
    should: 'say why each lands',
    actual: [result.plan.conversations.map((c) => `${c.id}: ${c.why}`), result.plan.threads.map((t) => t.why)],
    expected: [
      ['D0JANE: a direct message', 'G0TEAM: a direct message'],
      ['a mention', 'a reply in your thread', 'a mention', 'your own message'],
    ],
  })
})

test('a failure holds the cursor just before what failed, known threads count as such, and the next pass starts from the cursors', async () => {
  const f = fake({
    state: { feedCursor: '1759905000.000000', ownCursor: '1759940000.000000', runs: [] },
    entries: entries.filter((entry) => entry.feed_ts > '1759905000.000000'),
    own,
    kinds: { G0TEAM: 'group' },
    thread: (link) =>
      link.includes('C0DESIGN')
        ? { status: 'failed', message: 'rate_limited' }
        : link.includes('C0OPS')
          ? { status: 'known' }
          : { status: 'landed', docs: 1 },
    conversation: (id) =>
      id === 'G0TEAM' ? { status: 'failed', message: 'export failed' } : { status: 'landed', messages: 1, docs: 1 },
  })
  const result = await landActivity(f.host)
  assert({
    given: 'a thread from the feed and a group from the feed failing, and an own-message thread already captured',
    should:
      'hold the feed cursor before the earliest failure, move the own cursor to the newest own message, and count the known one',
    actual: [
      f.calls.slice(0, 2),
      f.state?.feedCursor,
      f.state?.ownCursor,
      result.known,
      result.errors.length,
      f.state?.runs[0]?.errors,
    ],
    expected: [
      'feed 1759905000.000000 at_user,keyword,thread_v2,dm|own 1759940000.000000'.split('|'),
      '1759930000.000099',
      '1759970000.000100',
      1,
      2,
      2,
    ],
  })
})

test('the rules choose the kinds, a dry run only plans, and an empty first pass still sets the cursors to now', async () => {
  const quiet = fake({ entries, own, rules: { dms: false, mentions: false, own: true } })
  await landActivity(quiet.host)
  assert({
    given: 'only own messages on',
    should: 'skip the feed and land from own messages alone',
    actual: quiet.calls.filter((call) => !call.startsWith('thread') && !call.startsWith('conversation')),
    expected: [`own ${WEEK_AGO}`, 'write state'],
  })
  const dry = fake({ entries, own })
  const planned = await landActivity(dry.host, { ...LAND_DEFAULTS, dryRun: true })
  assert({
    given: 'a dry run',
    should: 'plan without landing or writing',
    actual: [dry.calls, planned.plan.threads.length, planned.plan.conversations.length, planned.dryRun],
    expected: [[`feed ${WEEK_AGO} at_user,keyword,thread_v2,dm`, `own ${WEEK_AGO}`], 4, 2, true],
  })
  const empty = fake({})
  await landActivity(empty.host, { backfillDays: 1 })
  assert({
    given: 'a first pass that finds nothing, a day back',
    should: 'leave the cursors at now so the next pass asks for less',
    actual: [empty.calls[0], empty.state?.feedCursor, empty.state?.ownCursor],
    expected: ['feed 1759913600.000000 at_user,keyword,thread_v2,dm', '1760000000.000000', '1760000000.000000'],
  })
})
