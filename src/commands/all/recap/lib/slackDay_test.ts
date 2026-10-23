import { appendChannelDay, channelDayPath } from '#commands/all/slack/pull/lib/cache.ts'
import { makeTempDir } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import gatherSlackDay, { dropCapturedThreads, type SlackDocEntry } from './slackDay.ts'

const header = (channel: string, day: string) => ({
  channel,
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

/** Three UTC days of one channel, a quiet second channel, and a thread that keeps going after the gathered day. */
async function cache(): Promise<string> {
  const root = await makeTempDir({ prefix: 'sky-recap-slack-' })
  await appendChannelDay(channelDayPath(root, '2025-10-09', 'atlas'), header('atlas', '2025-10-09'), [
    { id: ROOT, timestamp: '2025-10-09 08:53', author: 'Jane Doe', text: 'Root' },
    {
      id: 'message-slack-C0ATLAS0001-1760003600-000100',
      timestamp: '2025-10-09 09:53',
      author: 'Joe Bloggs',
      text: `${line('Jane Doe', '2025-10-09 08:53', ROOT)}\n\nFirst reply`,
    },
    { id: OTHER, timestamp: '2025-10-09 10:53', author: 'Joe Bloggs', text: 'Other root' },
  ])
  await appendChannelDay(channelDayPath(root, '2025-10-10', 'atlas'), header('atlas', '2025-10-10'), [
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
    {
      id: 'message-slack-C0ATLAS0001-1760100000-000100',
      timestamp: '2025-10-10 12:40',
      author: 'Jane Doe',
      text: 'Today',
    },
    {
      id: 'message-slack-C0ATLAS0001-1760100600-000100',
      timestamp: '2025-10-10 12:50',
      author: 'Joe Bloggs',
      text: `${line('Jane Doe', '2025-10-10 12:40', 'message-slack-C0ATLAS0001-1760100000-000100')}\n\nSame-day reply`,
    },
  ])
  await appendChannelDay(channelDayPath(root, '2025-10-10', 'beacon'), header('beacon', '2025-10-10'), [
    {
      id: 'message-slack-C0BEACON001-1760095000-000100',
      timestamp: '2025-10-10 11:16',
      author: 'Jane Doe',
      text: 'Quiet',
    },
  ])
  await appendChannelDay(channelDayPath(root, '2025-10-11', 'atlas'), header('atlas', '2025-10-11'), [
    {
      id: 'message-slack-C0ATLAS0001-1760180000-000100',
      timestamp: '2025-10-11 10:53',
      author: 'Joe Bloggs',
      text: `${line('Jane Doe', '2025-10-09 08:53', ROOT)}\n\nThe day after`,
    },
  ])
  return root
}

test("gatherSlackDay ships the day's channels and the earlier part of the threads they reply to", async () => {
  const root = await cache()
  const result = await gatherSlackDay({ root, day: '2025-10-10' })

  assert({
    given: 'two channels with messages on the day',
    should: 'ship one channel document each, by name, with their message counts and the day’s span',
    actual: {
      channels: result.channels.map((entry) => [entry.kind, entry.path.slice(root.length), entry.day, entry.messages]),
      messages: result.messages,
      span: result.span,
    },
    expected: {
      channels: [
        ['channel', '/2025-10-10/atlas', '2025-10-10', 5],
        ['channel', '/2025-10-10/beacon', '2025-10-10', 1],
      ],
      messages: 6,
      span: { first: '2025-10-10 09:53', last: '2025-10-10 12:50' },
    },
  })
  assert({
    given: 'the channel document',
    should: 'carry the day’s messages whole, thread lines included, under the channel’s name',
    actual: [
      result.channels[0].doc.markdown.split('\n')[0],
      result.channels[0].doc.markdown.includes('Same-day reply'),
      result.channels[0].doc.yaml['channel'],
    ],
    expected: ['# #atlas · 2025-10-10', true, '#atlas'],
  })
  assert({
    given: 'replies to two roots on an earlier day, one same-day root, and one root older than the cache',
    should: 'ship a thread document for each earlier root only, named by the root’s day and id',
    actual: result.threads.map((entry) => [
      entry.kind,
      entry.path.slice(root.length),
      entry.day,
      entry.messages,
      entry.rootId,
    ]),
    expected: [
      ['thread', `/2025-10-09/atlas#${ROOT}`, '2025-10-09', 2, ROOT],
      ['thread', `/2025-10-09/atlas#${OTHER}`, '2025-10-09', 1, OTHER],
    ],
  })
  const thread = result.threads[0].doc
  assert({
    given: 'the thread document of the first root',
    should: 'hold the root and the replies before the day, in the saved-conversation shape, titled by its root',
    actual: {
      title: thread.markdown.split('\n')[0],
      root: thread.yaml['thread'],
      before: thread.markdown.includes('Root') && thread.markdown.includes('First reply'),
      heading: thread.markdown.includes('### 2025-10-09 09:53 - **Joe Bloggs**'),
      today: thread.markdown.includes('Second reply'),
      after: thread.markdown.includes('The day after'),
    },
    expected: {
      title: '# #atlas · the thread of Jane Doe, 2025-10-09 08:53',
      root: ROOT,
      before: true,
      heading: true,
      today: false,
      after: false,
    },
  })

  const byLink = [
    '---',
    'link: https://atlas.slack.com/archives/C0ATLAS0001/p1760090000000100?thread_ts=1760000000.000100&cid=C0ATLAS0001',
    '---',
    '',
    '# A later day of the first thread, captured from a reply',
    '',
  ].join('\n')
  const byAnchor = `# Captured\n\n## Conversation\n\n<a id="${OTHER}"></a>\n\n### 2025-10-09 10:53 - **Joe Bloggs**\n\nOther root\n`
  const roots = (entries: SlackDocEntry[]) => entries.map((entry) => entry.rootId)
  const one = dropCapturedThreads(result.threads, [byLink, '# A note without anchors or links'])
  assert({
    given: "a capture whose link names the first root through a reply's thread_ts",
    should: 'leave that thread to the capture and keep the other',
    actual: { kept: roots(one.kept), captured: roots(one.captured) },
    expected: { kept: [OTHER], captured: [ROOT] },
  })
  const both = dropCapturedThreads(result.threads, [byLink, byAnchor])
  assert({
    given: "a second capture carrying the other root's anchor",
    should: 'leave both threads to their captures',
    actual: { kept: roots(both.kept), captured: roots(both.captured) },
    expected: { kept: [], captured: [ROOT, OTHER] },
  })
  assert({
    given: 'a day the cache has nothing for',
    should: 'gather nothing without failing',
    actual: await gatherSlackDay({ root, day: '2025-10-20' }),
    expected: { channels: [], threads: [], messages: 0 },
  })
})
