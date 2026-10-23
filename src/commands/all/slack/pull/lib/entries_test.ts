import { formatSlackTimestamp } from '#commands/all/slack/lib/mod.ts'
import { assert, test } from '#test'
import type { ClockStamps } from './clock.ts'
import {
  authorOf,
  dayOf,
  isHousekeeping,
  isReply,
  parseCacheLines,
  parseMessageId,
  parseThreadLine,
  toCacheEntry,
  type SlackNames,
} from './entries.ts'

const names: SlackNames = {
  users: new Map([
    ['U0JANE', 'Jane Doe'],
    ['U0JOE', 'Joe Bloggs'],
  ]),
  channels: new Map([['C0ATLAS0002', 'design']]),
  usergroups: new Map([['S0TEAM', 'atlas-team']]),
}

/** Stamps as a Chicago machine gives them while the 8th is still open: the notebook clock runs past 24. */
const stamps = (ts: string): ClockStamps => {
  const utc = formatSlackTimestamp(ts, 'UTC')
  const system = formatSlackTimestamp(ts, 'America/Chicago')
  const [hours, minutes] = system.slice(11).split(':')
  return { notebook: `2025-10-08 ${Number(hours) + 24}:${minutes}`, system, zone: 'America/Chicago', utc }
}
const clock = (ts: string): string => `*${stamps(ts).system} America/Chicago · ${stamps(ts).utc} UTC*`

test('dayOf places a ts on its day in the given timezone', () => {
  assert({
    given: 'a ts at 08:53 UTC',
    should: 'be that UTC day',
    actual: dayOf('1760000000.000100', 'UTC'),
    expected: '2025-10-09',
  })
  assert({
    given: 'the same ts in Honolulu',
    should: 'fall on the day before',
    actual: dayOf('1760000000.000100', 'Pacific/Honolulu'),
    expected: '2025-10-08',
  })
})

test('toCacheEntry stamps the three clocks, names people, places a reply in its thread and lists files', () => {
  const reply = {
    channel_id: 'C0ATLAS0001',
    ts: '1760000000.000100',
    thread_ts: '1759990000.000500',
    author: { user_id: 'U0JOE' },
    content: 'Thanks @U0JANE, see <#C0ATLAS0002> and <!subteam^S0TEAM>',
    files: [{ name: 'diagram.png', mimetype: 'image/png' }],
  }
  assert({
    given: 'a reply with a mention, a channel link, a group ping and a file',
    should: 'head with the notebook time, then the clock line, the thread line, the names and the file',
    actual: toCacheEntry(reply, {
      stamps: stamps(reply.ts),
      names,
      root: { author: 'Jane Doe', timestamp: '2025-10-08 25:06' },
    }),
    expected: {
      id: 'message-slack-C0ATLAS0001-1760000000-000100',
      timestamp: '2025-10-08 27:53',
      author: 'Joe Bloggs',
      text: `${clock(reply.ts)}\n\n↳ *in the thread of [Jane Doe, 2025-10-08 25:06](#message-slack-C0ATLAS0001-1759990000-000500)*\n\nThanks @Jane Doe, see #design and @atlas-team\n\n*Attached: diagram.png (image/png)*`,
    },
  })
  const root = {
    channel_id: 'C0ATLAS0001',
    ts: '1759990000.000500',
    thread_ts: '1759990000.000500',
    author: { bot_id: 'B0ATLAS' },
    content: 'Build passed',
  }
  assert({
    given: 'a thread root posted by a bot',
    should: 'carry a clock line but no thread line, and name the bot by id',
    actual: toCacheEntry(root, { stamps: stamps(root.ts), names }),
    expected: {
      id: 'message-slack-C0ATLAS0001-1759990000-000500',
      timestamp: '2025-10-08 25:06',
      author: 'bot B0ATLAS',
      text: `${clock(root.ts)}\n\nBuild passed`,
    },
  })
  assert({
    given: 'a reply whose root is unknown',
    should: 'still link the root it answers',
    actual: toCacheEntry({ ...reply, content: 'Yes', files: undefined }, { stamps: stamps(reply.ts), names }).text,
    expected: `${clock(reply.ts)}\n\n↳ *in [a thread](#message-slack-C0ATLAS0001-1759990000-000500)*\n\nYes`,
  })
})

test('the clock and thread lines link and read back, markdown in the name and all', () => {
  const rootId = 'message-slack-C0ATLAS0001-1759990000-000500'
  const reply = {
    channel_id: 'C0ATLAS0001',
    ts: '1760000000.000100',
    thread_ts: '1759990000.000500',
    author: { user_id: 'U0JOE' },
    content: 'Yes',
  }
  const text = toCacheEntry(reply, {
    stamps: stamps(reply.ts),
    names,
    root: { author: 'J_D [bot]*', timestamp: '2025-10-08 25:06' },
  }).text
  assert({
    given: 'a root author with markdown in the name',
    should: 'escape it on the line',
    actual: text,
    expected: `${clock(reply.ts)}\n\n↳ *in the thread of [J\\_D \\[bot\\]\\*, 2025-10-08 25:06](#${rootId})*\n\nYes`,
  })
  assert({
    given: 'the text taken apart',
    should: 'give the clocks, the root id with the name unescaped and the time, and the message',
    actual: parseCacheLines(text),
    expected: {
      clock: { system: '2025-10-09 03:53', zone: 'America/Chicago', utc: '2025-10-09 08:53' },
      thread: { rootId, author: 'J_D [bot]*', timestamp: '2025-10-08 25:06' },
      body: 'Yes',
    },
  })
  assert({
    given: 'a reply whose root was out of reach',
    should: 'still give the root id',
    actual: parseThreadLine(`↳ *in [a thread](#${rootId})*\n\nYes`),
    expected: { rootId },
  })
  assert({
    given: 'a text with no clock line, a root, and a line from before roots were linked',
    should: 'give the message alone, and no thread',
    actual: [
      parseCacheLines('Build passed'),
      parseThreadLine('Build passed'),
      parseThreadLine('↳ *in the thread of Jane Doe, 2025-10-09 06:06*'),
    ],
    expected: [{ body: 'Build passed' }, undefined, undefined],
  })
  assert({
    given: 'a cache id and something else',
    should: 'give back the channel and ts, or nothing',
    actual: [parseMessageId(rootId), parseMessageId('attachment-1')],
    expected: [{ channelId: 'C0ATLAS0001', ts: '1759990000.000500' }, undefined],
  })
})

test('housekeeping subtypes are recognized, replies sit below a different root, unknown people keep their id', () => {
  assert({
    given: 'join, bot and plain messages',
    should: 'flag only the join',
    actual: [
      isHousekeeping({ subtype: 'channel_join' }),
      isHousekeeping({ subtype: 'bot_message' }),
      isHousekeeping({}),
    ],
    expected: [true, false, false],
  })
  assert({
    given: 'a root with replies, a reply, and a lone message',
    should: 'call only the reply a reply',
    actual: [
      isReply({ ts: '1.000001', thread_ts: '1.000001' }),
      isReply({ ts: '2.000002', thread_ts: '1.000001' }),
      isReply({ ts: '3.000003' }),
    ],
    expected: [false, true, false],
  })
  assert({
    given: 'an author no name resolved for',
    should: 'keep the id',
    actual: authorOf({ channel_id: 'C0ATLAS0001', ts: '1.000001', author: { user_id: 'U0NOBODY' } }, names),
    expected: 'U0NOBODY',
  })
})
