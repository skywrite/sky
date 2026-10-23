import { Document } from '#shared/models/Markdown/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import type { SlackDocEntry } from './slackDay.ts'
import { dueSlackDay, renderSlackInput, slackRecapHeader, slackRecapWhen } from './slackRecap.ts'

const ROOT = '/state/slack/days'
const entry = (kind: 'channel' | 'thread', day: string, name: string, messages: number): SlackDocEntry => ({
  doc: new Document({ channel: `#${name}` }, `# #${name} · ${day}\n\n## Conversation\n\nhello\n`),
  path: `${ROOT}/${day}/${name}${kind === 'thread' ? '#message-slack-C0ATLAS0001-1760000000-000100' : ''}`,
  kind,
  day,
  messages,
  ...(kind === 'thread' ? { rootId: 'message-slack-C0ATLAS0001-1760000000-000100' } : {}),
})

test('renderSlackInput stamps each document with its day and kind, threads first', () => {
  const day = new PlainDate(2025, 10, 10)
  const text = renderSlackInput({
    day,
    root: ROOT,
    channels: [entry('channel', '2025-10-10', 'atlas', 5), entry('channel', '2025-10-10', 'beacon', 1)],
    threads: [entry('thread', '2025-10-08', 'atlas', 2)],
    messages: 6,
  })
  const comments = text.split('\n').filter((line) => line.startsWith('<!-- 2025'))
  assert({
    given: 'two channel documents and one earlier thread',
    should: 'head with the counts and stamp the thread as two days ago and the channels as today',
    actual: [text.split('\n')[2], ...comments],
    expected: [
      '2 channels · 6 messages · 1 earlier thread',
      '<!-- 2025-10-08 Wed (2 days ago) | THREAD | 2025-10-08/atlas#message-slack-C0ATLAS0001-1760000000-000100 -->',
      '<!-- 2025-10-10 Fri (TODAY) | CHANNEL | 2025-10-10/atlas -->',
      '<!-- 2025-10-10 Fri (TODAY) | CHANNEL | 2025-10-10/beacon -->',
    ],
  })
  assert({
    given: 'the recap header for the day',
    should: 'title it by the day and count what was read',
    actual: slackRecapHeader(
      day,
      { channels: [entry('channel', '2025-10-10', 'atlas', 5)], threads: [], messages: 5 },
      1,
    ),
    expected: '# Slack — Oct 10\n\n1 channel · 5 messages · 1 earlier thread read\n',
  })
  assert({
    given: 'a span on the notebook clock, past midnight',
    should: 'give a when range and the file prefix time',
    actual: [
      slackRecapWhen(day, { first: '2025-10-10 07:10', last: '2025-10-10 31:02' }),
      slackRecapWhen(day, { first: '2025-10-10 07:10', last: '2025-10-10 07:10' }),
    ],
    expected: [
      { when: '2025-10-10 07:10 - 31:02', first: '07:10' },
      { when: '2025-10-10 07:10', first: '07:10' },
    ],
  })
})

test('dueSlackDay picks the newest day whose next day has started, that has messages and no recap', async () => {
  const d = (ymd: string) => PlainDate.fromString(ymd)
  const started = new Set(['2025-10-10', '2025-10-09', '2025-10-08'])
  const recapped = new Set(['2025-10-08'])
  const quiet = new Set(['2025-10-09'])
  const pick = (candidates: string[]) =>
    dueSlackDay({
      candidates: candidates.map(d),
      started: async (day) => started.has(day.ymd),
      hasRecap: async (day) => recapped.has(day.ymd),
      hasMessages: async (day) => !quiet.has(day.ymd),
    })
  assert({
    given: 'yesterday (the 9th) quiet, the 8th recapped, the 7th open for a recap',
    should: 'skip the quiet and the recapped days and pick the 7th',
    actual: (await pick(['2025-10-07', '2025-10-08', '2025-10-09']))?.ymd,
    expected: '2025-10-07',
  })
  assert({
    given: 'a day whose next day has not started',
    should: 'leave it for later',
    actual: await pick(['2025-10-10']),
    expected: undefined,
  })
})
