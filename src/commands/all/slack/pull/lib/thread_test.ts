import { makeTempDir } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import { appendChannelDay, channelDayPath } from './cache.ts'
import { readChannelDays, readThread } from './thread.ts'

const header = (day: string) => ({
  channel: 'atlas',
  channelId: 'C0ATLAS0001',
  workspace: 'https://atlas.slack.com',
  day,
})
/** 2025-10-09 08:53 UTC */
const ROOT = 'message-slack-C0ATLAS0001-1760000000-000100'
/** 2025-10-09 10:53 UTC */
const OTHER = 'message-slack-C0ATLAS0001-1760007200-000100'
/** 2025-06-15, before the cache begins */
const OLD = 'message-slack-C0ATLAS0001-1750000000-000100'
const line = (author: string, timestamp: string, rootId: string) =>
  `↳ *in the thread of [${author}, ${timestamp}](#${rootId})*`

async function cache(): Promise<string> {
  const root = await makeTempDir({ prefix: 'sky-slack-thread-' })
  await appendChannelDay(channelDayPath(root, '2025-10-09', 'atlas'), header('2025-10-09'), [
    { id: ROOT, timestamp: '2025-10-09 08:53', author: 'Jane Doe', text: 'Root' },
    {
      id: 'message-slack-C0ATLAS0001-1760003600-000100',
      timestamp: '2025-10-09 09:53',
      author: 'Joe Bloggs',
      text: `${line('Jane Doe', '2025-10-09 08:53', ROOT)}\n\nFirst reply`,
    },
    { id: OTHER, timestamp: '2025-10-09 10:53', author: 'Joe Bloggs', text: 'Other root' },
  ])
  await appendChannelDay(channelDayPath(root, '2025-10-10', 'atlas'), header('2025-10-10'), [
    {
      id: 'message-slack-C0ATLAS0001-1760090000-000100',
      timestamp: '2025-10-10 09:53',
      author: 'Jane Doe',
      text: `${line('Jane Doe', '2025-10-09 08:53', ROOT)}\n\nSecond reply`,
    },
    {
      id: 'message-slack-C0ATLAS0001-1760090100-000100',
      timestamp: '2025-10-10 09:55',
      author: 'Jane Doe',
      text: `${line('Joe Bloggs', '2025-10-09 10:53', OTHER)}\n\nOn the other thread`,
    },
    {
      id: 'message-slack-C0ATLAS0001-1760090200-000100',
      timestamp: '2025-10-10 09:56',
      author: 'Joe Bloggs',
      text: `↳ *in [a thread](#${OLD})*\n\nLate answer`,
    },
  ])
  return root
}

const brief = (message: { timestamp: string; author: string; text: string }) =>
  `${message.timestamp} ${message.author}: ${message.text.split('\n\n').at(-1)}`

test('readThread assembles the root and its replies across day files, in time order', async () => {
  const root = await cache()
  const thread = await readThread({ root, fileName: 'atlas', rootId: ROOT })
  assert({
    given: 'a root with a reply on its day and one the day after, beside another thread',
    should: 'return the root and its two replies in order, nothing from the other thread',
    actual: [thread.root && brief(thread.root), thread.replies.map(brief)],
    expected: [
      '2025-10-09 08:53 Jane Doe: Root',
      ['2025-10-09 09:53 Joe Bloggs: First reply', '2025-10-10 09:53 Jane Doe: Second reply'],
    ],
  })
  const old = await readThread({ root, fileName: 'atlas', rootId: OLD })
  assert({
    given: 'a root older than the cache',
    should: 'return no root and the reply that names it',
    actual: [old.root, old.replies.map(brief)],
    expected: [undefined, ['2025-10-10 09:56 Joe Bloggs: Late answer']],
  })
  assert({
    given: 'a channel with no files',
    should: 'read as nothing',
    actual: await readChannelDays(root, 'design'),
    expected: [],
  })
  assert({
    given: 'a cache that does not exist yet',
    should: 'read as nothing',
    actual: await readChannelDays(`${root}/none`, 'atlas'),
    expected: [],
  })
})

test('readChannelDays stops at toDay', async () => {
  const root = await cache()
  assert({
    given: 'a channel cached on two days and an upper bound of the first',
    should: 'read the first day only',
    actual: (await readChannelDays(root, 'atlas', undefined, '2025-10-09')).map(brief),
    expected: [
      '2025-10-09 08:53 Jane Doe: Root',
      '2025-10-09 09:53 Joe Bloggs: First reply',
      '2025-10-09 10:53 Joe Bloggs: Other root',
    ],
  })
})
