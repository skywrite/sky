import * as path from 'node:path'
import { makeTempDir } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import { appendChannelDay, channelDayPath } from './cache.ts'
import { writeRoster } from './roster.ts'
import { writeRules } from './rules.ts'
import { countCachedMessages, describeSlackChannels } from './status.ts'

const header = (channel: string, channelId: string, day: string) => ({
  channel,
  channelId,
  workspace: 'https://atlas.slack.com',
  day,
})
const entry = (channelId: string, seconds: number, text: string) => ({
  id: `message-slack-${channelId}-${seconds}-000100`,
  timestamp: '2025-10-09 08:53',
  author: 'Jane Doe',
  text,
})

test('describeSlackChannels joins the roster, the rules and the cache into the page’s rows', async () => {
  const root = await makeTempDir({ prefix: 'sky-slack-status-' })
  const days = path.join(root, 'days')
  const roster = path.join(root, 'channels.yaml')
  const rules = path.join(root, 'rules.yaml')
  const run = {
    at: '2025-10-09 08:53',
    added: 3,
    channels: 2,
    threads: 1,
    read: 2,
    unchanged: 1,
    muted: 1,
    errors: 0,
    seconds: 4,
  }
  await writeRoster(roster, {
    channels: [
      { id: 'C0ATLAS0001', name: 'atlas', cursor: '1760000000.000100' },
      { id: 'C0ATLAS0002', name: 'design', cursor: '1760003600.000100' },
      // Read once, nothing found: the cursor marks the window start, not a post
      { id: 'C0ATLAS0003', name: 'quiet', cursor: '1759395200.000000' },
      { id: 'C0ATLAS0004', name: 'new' },
    ],
    runs: [run],
  })
  await writeRules(rules, { muted: ['C0ATLAS0002'] })
  await appendChannelDay(channelDayPath(days, '2025-10-08', 'atlas'), header('atlas', 'C0ATLAS0001', '2025-10-08'), [
    entry('C0ATLAS0001', 1759900000, 'One'),
    entry('C0ATLAS0001', 1759900100, 'Two'),
  ])
  await appendChannelDay(channelDayPath(days, '2025-10-09', 'atlas'), header('atlas', 'C0ATLAS0001', '2025-10-09'), [
    entry('C0ATLAS0001', 1760000000, 'Three'),
  ])
  await appendChannelDay(channelDayPath(days, '2025-10-09', 'design'), header('design', 'C0ATLAS0002', '2025-10-09'), [
    entry('C0ATLAS0002', 1760003600, 'Mockups'),
  ])
  assert({
    given: 'two days of files for two channels',
    should: 'count the messages per channel file without parsing',
    actual: await countCachedMessages(days),
    expected: {
      days: 2,
      byFile: new Map([
        ['atlas', 3],
        ['design', 1],
      ]),
    },
  })
  assert({
    given: 'the roster, one muted channel and the cache',
    should:
      'list the channels most recent first with what is kept, a last post only where something is, the mute, and the totals',
    actual: await describeSlackChannels({ roster, rules, days }),
    expected: {
      joined: 4,
      muted: 1,
      kept: 4,
      days: 2,
      channels: [
        { id: 'C0ATLAS0002', name: 'design', on: false, kept: 1, lastPostEpoch: 1760003600 },
        { id: 'C0ATLAS0001', name: 'atlas', on: true, kept: 3, lastPostEpoch: 1760000000 },
        { id: 'C0ATLAS0003', name: 'quiet', on: true, kept: 0 },
        { id: 'C0ATLAS0004', name: 'new', on: true, kept: 0 },
      ],
      runs: [run],
    },
  })
  assert({
    given: 'no cache, no roster and no rules yet',
    should: 'read as empty',
    actual: await describeSlackChannels({
      roster: path.join(root, 'none.yaml'),
      rules: path.join(root, 'none-rules.yaml'),
      days: path.join(root, 'none'),
    }),
    expected: { joined: 0, muted: 0, kept: 0, days: 0, channels: [], runs: [] },
  })
})
