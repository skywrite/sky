import type { AgentSlackConversationCount, AgentSlackMessage } from '#commands/all/slack/cli/lib/agent-slack/types.ts'
import { formatSlackTimestamp } from '#commands/all/slack/lib/mod.ts'
import type { SlackWriteMessage } from '#shared/models/Message/slack/write.ts'
import { assert, test } from '#test'
import { PULL_DEFAULTS, matchesChannel, pullChannels, type PullHost } from './pull.ts'
import { type Roster, RUNS_KEPT } from './roster.ts'
import type { SlackRules } from './rules.ts'

/** 2025-10-09 08:53:20 UTC */
const NOW = 1760000000
const WINDOW_48H = '1759827200.000000'
const WINDOW_7D = '1759395200.000000'
const STAMP = '2025-10-09 08:53'
/** A clock with no notebook in reach: every stamp is the UTC wall clock. */
const CLOCK = /^\*\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC · \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC\*\n\n/

const message = (
  channel_id: string,
  ts: string,
  content: string,
  extra: Partial<AgentSlackMessage> = {},
): AgentSlackMessage => ({ channel_id, ts, author: { user_id: 'U0JANE' }, content, ...extra })

type Fake = {
  host: PullHost
  roster: Roster
  calls: string[]
  appended: { channel: string; day: string; entries: SlackWriteMessage[] }[]
  logs: string[]
}

function fake(input: {
  counts: AgentSlackConversationCount[]
  roster: Roster
  history: (channelId: string, oldest: string) => AgentSlackMessage[]
  thread?: (channelId: string, threadTs: string) => AgentSlackMessage[]
  rules?: SlackRules
}): Fake {
  const state = { roster: input.roster, calls: [] as string[], appended: [] as Fake['appended'], logs: [] as string[] }
  const host: PullHost = {
    now: NOW,
    timezone: 'UTC',
    clock: async (ts) => {
      const stamp = formatSlackTimestamp(ts, 'UTC')
      return { notebook: stamp, system: stamp, zone: 'UTC', utc: stamp }
    },
    log: (line) => state.logs.push(line),
    counts: async () => input.counts,
    channelNames: async (ids) => {
      state.calls.push(`names ${ids.join(',')}`)
      return new Map(ids.map((id) => [id, id.slice(2).toLowerCase()]))
    },
    history: async (channelId, oldest) => {
      state.calls.push(`history ${channelId} ${oldest}`)
      return input.history(channelId, oldest)
    },
    thread: async (channelId, threadTs) => {
      state.calls.push(`thread ${channelId} ${threadTs}`)
      return input.thread?.(channelId, threadTs) ?? []
    },
    names: async () => ({
      users: new Map([
        ['U0JANE', 'Jane Doe'],
        ['U0JOE', 'Joe Bloggs'],
      ]),
      channels: new Map(),
      usergroups: new Map(),
    }),
    readRoster: async () => state.roster,
    writeRoster: async (roster) => {
      state.calls.push('write roster')
      state.roster = roster
    },
    readRules: async () => input.rules ?? { muted: [] },
    append: async (channel, day, entries) => {
      state.appended.push({ channel: channel.name, day, entries })
      return { added: entries.length, fenced: [] }
    },
  }
  return { host, ...state }
}

const counts: AgentSlackConversationCount[] = [
  { id: 'C0QUIET', type: 'channel', latest: '1759000000.000000' },
  { id: 'C0NEW', type: 'channel', latest: '1759990001.000000' },
  { id: 'C0FRESH', type: 'channel', latest: '1759995000.000000' },
  { id: 'D0DM', type: 'im', latest: '1759999999.000000' },
]

const roster = (): Roster => ({
  channels: [
    {
      id: 'C0QUIET',
      name: 'quiet',
      cursor: '1759000000.000000',
      pulledAt: '2025-10-09 08:00',
      deepPulledAt: '2025-10-09 08:00',
    },
    {
      id: 'C0NEW',
      name: 'new',
      cursor: '1759980000.000000',
      pulledAt: '2025-10-09 08:00',
      deepPulledAt: '2025-10-09 08:00',
    },
  ],
  runs: [],
})

const history = (channelId: string): AgentSlackMessage[] => {
  if (channelId === 'C0NEW') {
    return [
      message('C0NEW', '1759970000.000000', 'Old root', {
        thread_ts: '1759970000.000000',
        latest_reply: '1759985000.000000',
      }),
      message('C0NEW', '1759990000.000500', 'New root', { author: { user_id: 'U0JOE' } }),
      message('C0NEW', '1759990001.000000', '@U0JOE has joined the channel', {
        subtype: 'channel_join',
        author: { user_id: 'U0JOE' },
      }),
    ]
  }
  if (channelId === 'C0FRESH') return [message('C0FRESH', '1759995000.000000', 'Hello')]
  return []
}

const thread = (): AgentSlackMessage[] => [
  message('C0NEW', '1759970000.000000', 'Old root', {
    thread_ts: '1759970000.000000',
    latest_reply: '1759985000.000000',
  }),
  message('C0NEW', '1759975000.000000', 'Old reply', { thread_ts: '1759970000.000000' }),
  message('C0NEW', '1759985000.000000', 'New reply', { thread_ts: '1759970000.000000', author: { user_id: 'U0JOE' } }),
]

test('pullChannels reads only channels with something new, freshest first, and moves each cursor past what it saw', async () => {
  const f = fake({ counts, roster: roster(), history, thread })
  const result = await pullChannels(f.host)
  assert({
    given: 'a quiet channel, a channel with new messages and a channel joined since the last pull',
    should: 'count the joined channels, skip the quiet one and read the other two',
    actual: { joined: result.joined, unchanged: result.unchanged, errors: result.errors },
    expected: { joined: 3, unchanged: 1, errors: [] },
  })
  assert({
    given: 'the two channels read',
    should: 'report the new channel first with a first read, then the active one with its thread',
    actual: result.pulled.map((channel) => [
      channel.name,
      channel.added,
      channel.threads,
      channel.backfilled,
      channel.days,
    ]),
    expected: [
      ['fresh', 1, 0, true, ['2025-10-09']],
      ['new', 2, 1, false, ['2025-10-09']],
    ],
  })
  assert({
    given: 'the calls made',
    should:
      'name the new channel, backfill it a week, re-read the active channel two days back and read its live thread',
    actual: f.calls,
    expected: [
      'names C0FRESH',
      'write roster',
      `history C0FRESH ${WINDOW_7D}`,
      'write roster',
      `history C0NEW ${WINDOW_48H}`,
      'thread C0NEW 1759970000.000000',
      'write roster',
      'write roster',
    ],
  })
  assert({
    given: 'the entries written for the active channel',
    should: 'hold the new reply, placed in its thread, and the new root, in order, without the join',
    actual: f.appended
      .filter((entry) => entry.channel === 'new')
      .flatMap((entry) => entry.entries.map((e) => [e.author, e.text.replace(CLOCK, '')])),
    expected: [
      [
        'Joe Bloggs',
        '↳ *in the thread of [Jane Doe, 2025-10-09 00:33](#message-slack-C0NEW-1759970000-000000)*\n\nNew reply',
      ],
      ['Joe Bloggs', 'New root'],
    ],
  })
  assert({
    given: 'every entry written',
    should: 'open with its clock line',
    actual: f.appended.flatMap((entry) => entry.entries).every((e) => CLOCK.test(e.text)),
    expected: true,
  })
  const after = new Map(f.roster.channels.map((channel) => [channel.id, channel]))
  assert({
    given: 'the roster afterwards',
    should:
      'move cursors past everything seen, the join included, stamp the reads and keep the quiet channel as it was',
    actual: ['C0QUIET', 'C0NEW', 'C0FRESH'].map((id) => after.get(id)),
    expected: [
      {
        id: 'C0QUIET',
        name: 'quiet',
        cursor: '1759000000.000000',
        pulledAt: '2025-10-09 08:00',
        deepPulledAt: '2025-10-09 08:00',
      },
      { id: 'C0NEW', name: 'new', cursor: '1759990001.000000', pulledAt: STAMP, deepPulledAt: '2025-10-09 08:00' },
      { id: 'C0FRESH', name: 'fresh', cursor: '1759995000.000000', pulledAt: STAMP, deepPulledAt: STAMP },
    ],
  })
  assert({
    given: 'the log',
    should: 'say what each read channel gained',
    actual: f.logs,
    expected: ['[pull] #fresh: 1 new, first read', '[pull] #new: 2 new, 1 thread(s)'],
  })
  assert({
    given: 'the roster afterwards',
    should: 'record the pull as a run, newest first',
    actual: f.roster.runs.map(({ seconds: _seconds, ...run }) => run),
    expected: [{ at: STAMP, added: 3, channels: 2, threads: 1, read: 2, unchanged: 1, muted: 0, errors: 0 }],
  })
})

test('a muted channel is left out, its cursor follows the channel, and the roster keeps the last few runs', async () => {
  const f = fake({ counts, roster: roster(), history, thread, rules: { muted: ['C0NEW'] } })
  const result = await pullChannels(f.host)
  assert({
    given: 'the active channel muted',
    should: 'read the new channel alone, count the muted one, and move its cursor to the newest channel message',
    actual: [
      result.pulled.map((channel) => channel.name),
      result.muted,
      result.unchanged,
      f.calls.filter((call) => call.startsWith('history')),
      f.roster.channels.find((channel) => channel.id === 'C0NEW')?.cursor,
      f.roster.runs[0]?.muted,
    ],
    expected: [['fresh'], 1, 1, [`history C0FRESH ${WINDOW_7D}`], '1759990001.000000', 1],
  })
  for (let i = 0; i < RUNS_KEPT + 2; i++) await pullChannels(f.host)
  assert({
    given: 'more pulls than the roster keeps',
    should: 'keep the newest few',
    actual: f.roster.runs.length,
    expected: RUNS_KEPT,
  })
  const narrowed = await pullChannels(f.host, { ...PULL_DEFAULTS, only: 'fresh' })
  assert({
    given: 'a pull narrowed to one channel',
    should: 'not count as one of the checks',
    actual: [narrowed.pulled.length, f.roster.runs.length],
    expected: [1, RUNS_KEPT],
  })
})

test('a deep read goes the whole window back, a failed channel keeps its cursor, and a recent root still gets its late replies', async () => {
  const f = fake({
    counts: [
      { id: 'C0THREADY', type: 'channel', latest: '1759990000.000000' },
      { id: 'C0BROKEN', type: 'channel', latest: '1759999000.000000' },
    ],
    roster: {
      channels: [
        {
          id: 'C0THREADY',
          name: 'thready',
          cursor: '1759990000.000000',
          pulledAt: '2025-10-07 08:00',
          deepPulledAt: '2025-10-07 08:00',
        },
        {
          id: 'C0BROKEN',
          name: 'broken',
          cursor: '1759000000.000000',
          pulledAt: '2025-10-09 08:00',
          deepPulledAt: '2025-10-09 08:00',
        },
      ],
      runs: [],
    },
    history: (channelId) => {
      if (channelId === 'C0BROKEN') throw new Error('rate_limited')
      return [
        message('C0THREADY', '1759990000.000000', 'Root', {
          thread_ts: '1759990000.000000',
          latest_reply: '1759995000.000000',
        }),
      ]
    },
    thread: () => [
      message('C0THREADY', '1759990000.000000', 'Root', { thread_ts: '1759990000.000000' }),
      message('C0THREADY', '1759995000.000000', 'Late reply', { thread_ts: '1759990000.000000' }),
    ],
  })
  const result = await pullChannels(f.host)
  assert({
    given: 'a channel whose history read fails',
    should: 'record the failure and go on',
    actual: result.errors,
    expected: [{ id: 'C0BROKEN', name: 'broken', message: 'rate_limited' }],
  })
  assert({
    given: 'the calls made',
    should: 'read the failed channel from its old cursor and the other one a week back for its deep read',
    actual: f.calls,
    expected: [
      'history C0BROKEN 1759000000.000000',
      `history C0THREADY ${WINDOW_7D}`,
      'thread C0THREADY 1759990000.000000',
      'write roster',
      'write roster',
    ],
  })
  assert({
    given: 'a root no newer than the cursor that gained a reply',
    should: 'write the reply and move the cursor to it',
    actual: [
      result.pulled.map((channel) => [channel.name, channel.added, channel.threads]),
      f.roster.channels.map((channel) => [channel.id, channel.cursor, channel.deepPulledAt]),
    ],
    expected: [
      [['thready', 1, 1]],
      [
        ['C0THREADY', '1759995000.000000', STAMP],
        ['C0BROKEN', '1759000000.000000', '2025-10-09 08:00'],
      ],
    ],
  })
})

test('a first read that finds nothing leaves the cursor at the window start, so the channel is quiet next time', async () => {
  const counts: AgentSlackConversationCount[] = [{ id: 'C0EMPTY', type: 'channel', latest: '1700000000.000000' }]
  const f = fake({ counts, roster: { channels: [], runs: [] }, history: () => [] })
  const first = await pullChannels(f.host)
  assert({
    given: 'a joined channel whose last message predates the backfill window',
    should: 'read it once, add nothing and set its cursor to the window start',
    actual: [first.pulled.map((channel) => [channel.name, channel.added]), f.roster.channels[0]?.cursor, f.logs],
    expected: [[['empty', 0]], WINDOW_7D, []],
  })
  const again = await pullChannels(f.host)
  assert({
    given: 'the next pull with nothing new',
    should: 'skip the channel without reading it',
    actual: [again.unchanged, again.pulled.length, f.calls.filter((call) => call.startsWith('history')).length],
    expected: [1, 0, 1],
  })
})

test('--channel narrows the pull to one channel and --max stops after the freshest ones', async () => {
  const only = fake({ counts, roster: roster(), history, thread })
  const narrowed = await pullChannels(only.host, { ...PULL_DEFAULTS, only: '#New' })
  assert({
    given: 'a channel name with a # and different case',
    should: 'read that channel alone',
    actual: [narrowed.pulled.map((channel) => channel.name), narrowed.unchanged, narrowed.joined],
    expected: [['new'], 0, 3],
  })
  const capped = fake({ counts, roster: roster(), history, thread })
  const first = await pullChannels(capped.host, { ...PULL_DEFAULTS, max: 1 })
  assert({
    given: 'a cap of one',
    should: 'read only the most recently active channel',
    actual: first.pulled.map((channel) => channel.name),
    expected: ['fresh'],
  })
  assert({
    given: 'names and ids',
    should: 'match a name with or without #, any case, and an id',
    actual: [
      matchesChannel({ id: 'C0NEW', name: 'new' }, 'NEW'),
      matchesChannel({ id: 'C0NEW', name: 'new' }, 'c0new'),
      matchesChannel({ id: 'C0NEW', name: 'new' }, '#newer'),
      matchesChannel({ id: 'C0NEW', name: 'new' }, undefined),
    ],
    expected: [true, true, false, true],
  })
})
