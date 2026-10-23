import { readFile } from 'node:fs/promises'
import { makeTempDir } from '#shared/fs/mod.ts'
import Document from '#shared/models/Markdown/Document/mod.ts'
import { parseSlackConversation } from '#shared/models/Message/slack/parse.ts'
import { assert, test } from '#test'
import {
  appendChannelDay,
  channelDayPath,
  channelFileName,
  fenceRunawayText,
  fenceText,
  readChannelDay,
} from './cache.ts'

test('channelFileName is the channel name, joined by the id when another joined channel shares it', () => {
  const all = [
    { id: 'C0ATLAS0001', name: 'atlas' },
    { id: 'C0ATLAS0002', name: 'design' },
    { id: 'C0ATLAS0003', name: 'design' },
  ]
  assert({ given: 'a unique name', should: 'use it as is', actual: channelFileName(all[0], all), expected: 'atlas' })
  assert({
    given: 'a name two joined channels share',
    should: 'add the id',
    actual: channelFileName(all[1], all),
    expected: 'design-C0ATLAS0002',
  })
  assert({
    given: 'a name with spaces and slashes',
    should: 'join the pieces with dashes',
    actual: channelFileName({ id: 'C0ATLAS0004', name: 'ext/atlas team' }, all),
    expected: 'ext-atlas-team',
  })
})

test('appendChannelDay creates the day file once and adds only the messages it lacks', async () => {
  const root = await makeTempDir({ prefix: 'sky-slack-cache-' })
  const file = channelDayPath(root, '2026-10-19', 'atlas')
  const header = { channel: 'atlas', channelId: 'C0ATLAS0001', workspace: 'https://atlas.slack.com', day: '2026-10-19' }
  const first = {
    id: 'message-slack-C0ATLAS0001-1760000000-000100',
    timestamp: '2026-10-19 09:14',
    author: 'Jane Doe',
    text: 'First.',
  }
  const second = {
    id: 'message-slack-C0ATLAS0001-1760000100-000200',
    timestamp: '2026-10-19 09:16',
    author: 'Joe Bloggs',
    text: 'Second.',
  }
  const added = [
    (await appendChannelDay(file, header, [first])).added,
    (await appendChannelDay(file, header, [first, second])).added,
    (await appendChannelDay(file, header, [second])).added,
  ]
  const doc = Document.fromMarkdown(await readFile(file, 'utf8'))
  assert({
    given: 'three appends with overlapping messages',
    should: 'count only what each one added',
    actual: added,
    expected: [1, 1, 0],
  })
  assert({
    given: 'the file header',
    should: 'name the channel, its id, the workspace and the day',
    actual: doc.yaml,
    expected: {
      channel: '#atlas',
      channel_id: 'C0ATLAS0001',
      workspace: 'https://atlas.slack.com',
      day: '2026-10-19',
      clock: 'UTC',
    },
  })
  assert({
    given: 'the file body',
    should: 'hold both messages once, in order, under Conversation',
    actual: parseSlackConversation(doc.markdown).messages.map(
      (message) => `${message.timestamp} ${message.author}: ${message.body.trim()}`,
    ),
    expected: ['2026-10-19 09:14 Jane Doe: First.', '2026-10-19 09:16 Joe Bloggs: Second.'],
  })
  assert({
    given: 'the title line',
    should: 'say which channel and day this is',
    actual: doc.markdown.startsWith('# #atlas · 2026-10-19 UTC\n'),
    expected: true,
  })
})

test('readChannelDay gives each message back with its id and, for a reply, where its thread line points', async () => {
  const root = await makeTempDir({ prefix: 'sky-slack-cache-' })
  const file = channelDayPath(root, '2026-10-19', 'atlas')
  const header = { channel: 'atlas', channelId: 'C0ATLAS0001', workspace: 'https://atlas.slack.com', day: '2026-10-19' }
  const rootId = 'message-slack-C0ATLAS0001-1760000000-000100'
  await appendChannelDay(file, header, [
    { id: rootId, timestamp: '2026-10-19 09:14', author: 'Jane Doe', text: 'Root' },
    {
      id: 'message-slack-C0ATLAS0001-1760000100-000200',
      timestamp: '2026-10-19 09:16',
      author: 'Joe Bloggs',
      text: `↳ *in the thread of [Jane Doe, 2026-10-19 09:14](#${rootId})*\n\nReply`,
    },
  ])
  assert({
    given: 'a root and a reply written to a day file',
    should: 'read back with ids, text and the reply pointing at the root',
    actual: await readChannelDay(file),
    expected: [
      { id: rootId, timestamp: '2026-10-19 09:14', author: 'Jane Doe', text: 'Root' },
      {
        id: 'message-slack-C0ATLAS0001-1760000100-000200',
        timestamp: '2026-10-19 09:16',
        author: 'Joe Bloggs',
        text: `↳ *in the thread of [Jane Doe, 2026-10-19 09:14](#${rootId})*\n\nReply`,
        thread: { rootId, author: 'Jane Doe', timestamp: '2026-10-19 09:14' },
      },
    ],
  })
  assert({
    given: 'a day the channel has no file for',
    should: 'read as no messages',
    actual: await readChannelDay(channelDayPath(root, '2026-10-18', 'atlas')),
    expected: [],
  })
})

test('a text that would swallow the messages after it is kept inside a code fence', async () => {
  const root = await makeTempDir({ prefix: 'sky-slack-cache-' })
  const file = channelDayPath(root, '2026-10-19', 'atlas')
  const header = { channel: 'atlas', channelId: 'C0ATLAS0001', workspace: 'https://atlas.slack.com', day: '2026-10-19' }
  const html = {
    id: 'message-slack-C0ATLAS0001-1760000000-000100',
    timestamp: '2026-10-19 09:14',
    author: 'Jane Doe',
    text: '<pre>\nnot closed',
  }
  const fence = {
    id: 'message-slack-C0ATLAS0001-1760000050-000100',
    timestamp: '2026-10-19 09:15',
    author: 'Jane Doe',
    text: '```\ncode with ``` inside\nstill open',
  }
  const plain = {
    id: 'message-slack-C0ATLAS0001-1760000100-000200',
    timestamp: '2026-10-19 09:16',
    author: 'Joe Bloggs',
    text: 'Fine.',
  }
  assert({
    given: 'an unclosed HTML block, an unclosed code fence and a plain text',
    should: 'fence the first two only',
    actual: fenceRunawayText([html, fence, plain]).fenced,
    expected: [html.id, fence.id],
  })
  assert({
    given: 'a text with a three-backtick fence inside',
    should: 'wrap it in a longer fence',
    actual: fenceText(fence.text),
    expected: '````\n```\ncode with ``` inside\nstill open\n````',
  })
  const written = await appendChannelDay(file, header, [html, fence, plain])
  const doc = Document.fromMarkdown(await readFile(file, 'utf8'))
  assert({
    given: 'the three appended together',
    should: 'write all three as separate messages and say which were fenced',
    actual: [
      written,
      parseSlackConversation(doc.markdown).messages.map(
        (message) => `${message.author}: ${message.body.trim().split('\n')[0]}`,
      ),
    ],
    expected: [{ added: 3, fenced: [html.id, fence.id] }, ['Jane Doe: ```', 'Jane Doe: ````', 'Joe Bloggs: Fine.']],
  })
})
