import { makeTempDir } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import { appendChannelDay, channelDayPath } from './cache.ts'
import { readNotebookDay, utcDaysOf } from './dayView.ts'

const header = (channel: string, day: string) => ({
  channel,
  channelId: `C0${channel.toUpperCase()}001`,
  workspace: 'https://atlas.slack.com',
  day,
})

/** Two UTC days of one channel whose messages fall on three notebook days, and a second channel. */
async function cache(): Promise<string> {
  const root = await makeTempDir({ prefix: 'sky-slack-dayview-' })
  await appendChannelDay(channelDayPath(root, '2025-10-09', 'atlas'), header('atlas', '2025-10-09'), [
    {
      // 2025-10-09 06:10 UTC: one in the morning in Chicago, the 8th still open
      id: 'message-slack-C0ATLAS001-1759990200-000100',
      timestamp: '2025-10-08 25:10',
      author: 'Jane Doe',
      text: 'Late on the 8th',
    },
    {
      id: 'message-slack-C0ATLAS001-1760000000-000100',
      timestamp: '2025-10-09 03:53',
      author: 'Joe Bloggs',
      text: 'Morning of the 9th',
    },
  ])
  await appendChannelDay(channelDayPath(root, '2025-10-10', 'atlas'), header('atlas', '2025-10-10'), [
    {
      // 2025-10-10 12:00 UTC: seven in the morning in Chicago, before the 10th started
      id: 'message-slack-C0ATLAS001-1760097600-000100',
      timestamp: '2025-10-09 31:00',
      author: 'Jane Doe',
      text: 'Early on the 10th, still the 9th',
    },
    {
      id: 'message-slack-C0ATLAS001-1760105100-000100',
      timestamp: '2025-10-10 09:05',
      author: 'Joe Bloggs',
      text: 'The 10th proper',
    },
  ])
  await appendChannelDay(channelDayPath(root, '2025-10-10', 'beacon'), header('beacon', '2025-10-10'), [
    {
      id: 'message-slack-C0BEACON001-1760099400-000100',
      timestamp: '2025-10-09 31:30',
      author: 'Jane Doe',
      text: 'Beacon, still the 9th',
    },
  ])
  return root
}

const brief = (view: { channel: string; channelId?: string; messages: { timestamp: string; text: string }[] }) => [
  view.channel,
  view.channelId,
  view.messages.map((message) => `${message.timestamp} ${message.text}`),
]

test('readNotebookDay gathers a notebook day across the UTC files it spans, by channel, in time order', async () => {
  const root = await cache()
  assert({
    given: 'the 9th, whose messages sit in two UTC files and two channels',
    should: 'return both channels by name with only that day’s messages, in time order',
    actual: (await readNotebookDay(root, '2025-10-09')).map(brief),
    expected: [
      [
        'atlas',
        'C0ATLAS001',
        ['2025-10-09 03:53 Morning of the 9th', '2025-10-09 31:00 Early on the 10th, still the 9th'],
      ],
      ['beacon', 'C0BEACON001', ['2025-10-09 31:30 Beacon, still the 9th']],
    ],
  })
  assert({
    given: 'the 8th, which only the 9th’s UTC file holds a message of',
    should: 'return that message alone',
    actual: (await readNotebookDay(root, '2025-10-08')).map(brief),
    expected: [['atlas', 'C0ATLAS001', ['2025-10-08 25:10 Late on the 8th']]],
  })
  assert({
    given: 'a day with nothing',
    should: 'return no channels',
    actual: await readNotebookDay(root, '2025-10-12'),
    expected: [],
  })
  assert({
    given: 'a notebook day',
    should: 'reach from the UTC day before to the second UTC day after',
    actual: utcDaysOf('2025-10-09'),
    expected: ['2025-10-08', '2025-10-09', '2025-10-10', '2025-10-11'],
  })
})
