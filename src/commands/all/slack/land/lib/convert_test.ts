import type { AgentSlackMessage } from '#commands/all/slack/cli/lib/agent-slack/types.ts'
import type { SlackCaptureFile } from '#commands/all/slack/lib/voiceFiles.ts'
import { assert, test } from '#test'
import { toCaptureMessages } from './convert.ts'

test('toCaptureMessages names people, keeps times in the notebook zone, and carries files through enrichment', async () => {
  const messages: AgentSlackMessage[] = [
    { channel_id: 'D0ATLAS0001', ts: '1760000000.000100', author: { user_id: 'U0JANE' }, content: 'Hi @U0JOE' },
    {
      channel_id: 'D0ATLAS0001',
      ts: '1760000100.000200',
      author: { user_id: 'U0JOE' },
      content: 'A memo',
      files: [{ name: 'memo.m4a', mimetype: 'audio/mp4', path: '/tmp/F0MEMO01.m4a' }],
    },
    { channel_id: 'D0ATLAS0001', ts: '1760000200.000300', author: { bot_id: 'B0BOT' }, content: 'Build passed' },
  ]
  const enriched: string[] = []
  const actual = await toCaptureMessages(messages, {
    workspace: 'https://atlas.slack.com',
    timezone: 'UTC',
    names: {
      users: new Map([
        ['U0JANE', 'Jane Doe'],
        ['U0JOE', 'Joe Bloggs'],
      ]),
      channels: new Map(),
      usergroups: new Map(),
    },
    enrich: async (files) => {
      enriched.push(...files.map((file) => file.id ?? '?'))
      return files.map(
        (file): SlackCaptureFile => ({
          ...file,
          voiceMemo: { workspaceUrl: 'https://atlas.slack.com' },
          mode: 'hosted',
        }),
      )
    },
  })
  assert({
    given: 'a mention, a message with a voice memo, and a bot',
    should: 'resolve the name, enrich the file once by its id, and name the bot by id',
    actual: [
      enriched,
      actual.map((message) => [message.timeLabel, message.userName ?? message.userId, message.text]),
      actual[1].files?.map((file) => [file.id, Boolean(file.voiceMemo), file.mode, file.sourceUrl]),
      actual[2].userId,
    ],
    expected: [
      ['F0MEMO01'],
      [
        ['2025-10-09 08:53', 'Jane Doe', 'Hi @Joe Bloggs'],
        ['2025-10-09 08:55', 'Joe Bloggs', 'A memo'],
        ['2025-10-09 08:56', 'bot B0BOT', 'Build passed'],
      ],
      [['F0MEMO01', true, 'hosted', 'https://atlas.slack.com/archives/D0ATLAS0001/p1760000100000200']],
      undefined,
    ],
  })
})
