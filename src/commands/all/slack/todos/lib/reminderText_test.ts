import { MockLanguageModelV4 } from 'ai/test'
import type { LaterCaptureRow } from '#commands/all/slack/saved/lib/capture.ts'
import { CommandResult, type CommandService } from '#commands/mod.ts'
import { assert, test } from '#test'
import { cleanReminderText, createReminderWriter, reminderText, type ReminderSource } from './reminderText.ts'

const source: ReminderSource = {
  link: 'https://atlas.slack.com/archives/C0ATLAS/p1740000000000001',
  channelId: 'C0ATLAS',
  channelName: 'atlas',
  conversationType: 'channel',
  messageTs: '1740000000.000001',
  message: {
    ts: '1740000000.000001',
    userName: 'Jane Doe',
    text: `Hello team! ${'Here is some background. '.repeat(25)}Please review the Atlas launch proposal and send feedback.`,
  },
  thread: {
    threadTs: '1740000000.000001',
    replies: [{ ts: '1740000001.000001', userName: 'Jane Doe', text: 'The proposal covers pricing for the pilot.' }],
  },
}
const row: LaterCaptureRow = {
  link: source.link,
  timeLabel: '10:00',
  item: {
    channel_id: source.channelId,
    ts: source.messageTs,
    message: { content: 'Hello team! Here is some background…' },
  },
}
const FRIENDLY = 'Review the Atlas launch proposal and send Jane feedback on pilot pricing.'

function fixture() {
  const control = { text: FRIENDLY, finishReason: 'stop' as 'stop' | 'length', fail: false }
  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      if (control.fail) throw new Error('Synthetic model outage')
      return {
        content: [{ type: 'text', text: control.text }],
        finishReason: { unified: control.finishReason, raw: control.finishReason },
        usage: {
          inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 20, text: 20, reasoning: 0 },
        },
        warnings: [],
      }
    },
  })
  return { control, model, write: createReminderWriter(() => ({ model })) }
}

test('Slack reminder wording uses the full selected message and its thread context', async () => {
  const f = fixture()
  const calls: unknown[] = []
  const tasks = {
    run: async (command: string, args: unknown) => {
      calls.push([command, args])
      return CommandResult.success(source)
    },
  } as unknown as Pick<CommandService, 'run'>
  const text = await reminderText(row, tasks, { write: f.write })
  const prompt = JSON.stringify(f.model.doGenerateCalls[0]?.prompt)
  assert({
    given: 'a clipped Later preview with its actual request beyond 300 characters and a clarifying reply',
    should: 'read the selected source, give the model the full request and thread, and use its friendly wording',
    actual: [
      calls,
      text,
      prompt.includes('Please review the Atlas launch proposal and send feedback.'),
      prompt.includes('The proposal covers pricing for the pilot.'),
      prompt.includes('Jane Doe'),
    ],
    expected: [[['slack:cli:export', { link: row.link }]], FRIENDLY, true, true, true],
  })
})

test('Slack reminder text stays plain and rejects malformed model output', () => {
  assert({
    given: 'a quoted one-line reminder and outputs that could break or confuse a linked reminder',
    should: 'unwrap the plain text and reject empty, long, multi-line, formatted or conversational responses',
    actual: [
      `  “${FRIENDLY}”  `,
      `Reminder: ${FRIENDLY}`,
      '',
      'A'.repeat(241),
      'Review Atlas\nThen reply to Jane',
      'Read [Atlas](https://example.com)',
      'See https://example.com/atlas',
      '<script>Example</script>',
      '**Review Atlas**',
      '- Review Atlas',
      '1. Review Atlas',
      'Could you share more context?',
    ].map((text) => cleanReminderText(text) ?? null),
    expected: [FRIENDLY, FRIENDLY, ...Array(10).fill(null)],
  })
})

test('Slack reminder rewrites fall back on model failure, clipping or an unusable answer', async () => {
  const f = fixture()
  const results: Array<string | undefined> = []
  f.control.fail = true
  results.push(await f.write(source))
  f.control.fail = false
  f.control.finishReason = 'length'
  results.push(await f.write(source))
  f.control.finishReason = 'stop'
  f.control.text = 'Please provide the message?'
  results.push(await f.write(source))
  const unavailable = createReminderWriter(() => {
    throw new Error('No model key')
  })
  results.push(await unavailable(source))
  assert({
    given: 'an outage, token limit, unusable reply or missing model key',
    should: 'return no rewrite so capture can retain the original message preview, without model retries',
    actual: [results.map((text) => text ?? null), f.model.doGenerateCalls.length],
    expected: [[null, null, null, null], 3],
  })
})

test('Slack reminder rewrites bound long conversations while retaining the opening and latest context', async () => {
  const f = fixture()
  await f.write({
    ...source,
    message: { ...source.message, text: `Opening subject ${'background '.repeat(2000)} Final request` },
    thread: {
      threadTs: source.messageTs,
      replies: [
        { ts: '1740000001.000001', text: `Earlier context ${'background '.repeat(2000)} Latest clarification` },
      ],
    },
  })
  const prompt = JSON.stringify(f.model.doGenerateCalls[0]?.prompt)
  assert({
    given: 'a message and thread larger than the light model needs',
    should: 'bound the input and keep the beginning and end of both sources',
    actual: [
      prompt.length < 23_000,
      ...['Opening subject', 'Final request', 'Earlier context', 'Latest clarification'].map((text) =>
        prompt.includes(text),
      ),
    ],
    expected: [true, true, true, true, true],
  })
})

test('missing or mismatched Slack sources cannot generate a reminder for the wrong message', async () => {
  let writes = 0
  const outcomes = [
    CommandResult.fail('Synthetic Slack outage'),
    CommandResult.success({ ...source, channelId: 'C0OTHER' }),
    CommandResult.success({ ...source, message: { ...source.message, ts: '1740000000.000002' } }),
  ]
  const results: Array<string | undefined> = []
  for (const outcome of outcomes) {
    results.push(
      await reminderText(row, { run: async () => outcome } as unknown as Pick<CommandService, 'run'>, {
        write: async () => {
          writes++
          return FRIENDLY
        },
      }),
    )
  }
  assert({
    given: 'an unavailable source or a different channel/message from the selected to-do',
    should: 'retain the original preview without sending incorrect evidence to the model',
    actual: [results.map((text) => text ?? null), writes],
    expected: [[null, null, null], 0],
  })
})

test('cancelling a Slack reminder rewrite starts no model request', async () => {
  const f = fixture()
  const controller = new AbortController()
  controller.abort(new Error('Synthetic cancellation'))
  let error = ''
  try {
    await f.write(source, controller.signal)
  } catch (failure) {
    error = (failure as Error).message
  }
  assert({
    given: 'a cancelled capture',
    should: 'propagate cancellation without asking the model',
    actual: [error, f.model.doGenerateCalls.length],
    expected: ['Synthetic cancellation', 0],
  })
})
