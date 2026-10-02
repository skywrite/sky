import type { ModelMessage } from 'ai'
import { assert, test } from '#test'
import type { ToolRun } from './mod.ts'
import { recordToolExecution, restoreToolRuns, toolRunsFromMessages } from './toolRuns.ts'

test('Concurrent calls of the same tool retain their own parameters, results, and failures', () => {
  const runs: ToolRun[] = []
  recordToolExecution(runs, 1, {
    type: 'tool-execution-start',
    phase: 'preparing',
    toolName: 'me_voice',
    toolCallId: 'first',
    started: 1000,
  })
  recordToolExecution(runs, 1, {
    type: 'tool-execution-start',
    phase: 'running',
    toolName: 'me_voice',
    toolCallId: 'first',
    started: 2000,
    input: {
      action: 'draft',
      meaning: 'Draft one.',
      context: 'A familiar colleague.',
      nested: { apiKey: 'synthetic-secret' },
    },
  })
  recordToolExecution(runs, 1, {
    type: 'tool-execution-start',
    phase: 'running',
    toolName: 'me_voice',
    toolCallId: 'second',
    started: 3000,
    input: { meaning: 'Draft two.' },
  })
  recordToolExecution(runs, 1, {
    type: 'tool-execution-end',
    toolName: 'me_voice',
    toolCallId: 'second',
    finished: 4000,
    error: 'Timed out',
  })
  recordToolExecution(runs, 1, {
    type: 'tool-execution-end',
    toolName: 'me_voice',
    toolCallId: 'first',
    finished: 5000,
    output: { success: true, draft: 'Ready.' },
  })
  const restored = restoreToolRuns(JSON.parse(JSON.stringify(runs)))!
  assert({
    given: 'overlapping calls that finish in reverse order',
    should: 'retain the complete inspectable input and correlate results by call ID through recovery',
    actual: restored.map(({ callId, input, output, error, started, finished, status, subject }) => ({
      callId,
      input,
      output,
      error,
      started,
      finished,
      status,
      subject,
    })),
    expected: [
      {
        callId: 'first',
        input: {
          action: 'draft',
          meaning: 'Draft one.',
          context: 'A familiar colleague.',
          nested: { apiKey: '[redacted]' },
        },
        output: { success: true, draft: 'Ready.' },
        error: undefined,
        started: 1000,
        finished: 5000,
        status: 'success',
        subject: 'Draft one.',
      },
      {
        callId: 'second',
        input: { meaning: 'Draft two.' },
        output: undefined,
        error: 'Timed out',
        started: 3000,
        finished: 4000,
        status: 'error',
        subject: 'Draft two.',
      },
    ],
  })
})

test('Older recovery history supplies input and output without inventing timing', () => {
  const messages: ModelMessage[] = [
    { role: 'user', content: 'Draft an update.' },
    {
      role: 'assistant',
      content: [{ type: 'tool-call', toolCallId: 'first', toolName: 'me_voice', input: { meaning: 'Ready.' } }],
    },
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'first',
          toolName: 'me_voice',
          output: { type: 'json', value: { success: true, draft: 'Ready.' } },
        },
      ],
    },
    { role: 'assistant', content: 'Ready.' },
    { role: 'user', content: 'Revise it.' },
    {
      role: 'assistant',
      content: [{ type: 'tool-call', toolCallId: 'second', toolName: 'me_voice', input: { meaning: 'Almost ready.' } }],
    },
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'second',
          toolName: 'me_voice',
          output: { type: 'json', value: { success: false, error: 'Model unavailable' } },
        },
      ],
    },
  ]
  const runs = toolRunsFromMessages(messages)
  const unfinished = toolRunsFromMessages(messages.slice(0, 2))
  assert({
    given: 'a retained call without a completion result',
    should: 'keep its input without claiming successful execution',
    actual: [unfinished[0].status, Boolean(unfinished[0].error), unfinished[0].input],
    expected: ['error', true, { meaning: 'Ready.' }],
  })
  assert({
    given: 'a pre-existing recovery snapshot with full provider history',
    should: 'attach each exchange to the right reply and retain failure outcomes',
    actual: runs.map(({ at, input, output, status, finished }) => ({ at, input, output, status, finished })),
    expected: [
      {
        at: 1,
        input: { meaning: 'Ready.' },
        output: { success: true, draft: 'Ready.' },
        status: 'success',
        finished: undefined,
      },
      {
        at: 3,
        input: { meaning: 'Almost ready.' },
        output: { success: false, error: 'Model unavailable' },
        status: 'error',
        finished: undefined,
      },
    ],
  })
})

test('Recovery marks an unfinished tool as interrupted', () => {
  const restored = restoreToolRuns([
    { tool: 'me_voice', callId: 'first', at: 1, started: 1000, lines: [], status: null, input: { meaning: 'Ready.' } },
  ])!
  assert({
    given: 'a service restart during a tool call',
    should: 'keep the input and stop the running indicator without claiming success',
    actual: [restored[0].status, Boolean(restored[0].error), restored[0].input],
    expected: ['error', true, { meaning: 'Ready.' }],
  })
})

test("A Google tool's run carries the account its result reports", () => {
  /** A call's [account, subject] once it has ended. */
  const ended = (tool: string, input: unknown, output: unknown) => {
    const runs: ToolRun[] = []
    recordToolExecution(runs, 1, {
      type: 'tool-execution-start',
      phase: 'running',
      toolName: tool,
      toolCallId: 'c',
      started: 1,
      input,
    })
    recordToolExecution(runs, 1, { type: 'tool-execution-end', toolName: tool, toolCallId: 'c', finished: 2, output })
    return [runs[0]!.account, runs[0]!.subject]
  }

  assert({
    given: 'a file read that named no account, once the result says which account opened it',
    should: 'keep the account beside the subject the call already had',
    actual: ended(
      'google_read',
      { target: 'https://docs.google.com/document/d/abc/edit' },
      { success: true, account: 'jane@atlas.example' },
    ),
    expected: ['jane@atlas.example', 'docs.google.com/document/d/abc/edit'],
  })

  assert({
    given: 'a call whose subject only names its account by a part of it, and an inbox listing over two mailboxes',
    should: 'let the full address stand alone, and say how many accounts a listing covered',
    actual: [
      ended('google_email_draft_new', { account: 'atlas', body: 'Hello Jane' }, { account: 'jane@atlas.example' }),
      ended(
        'google_email_inbox_view',
        { label: 'INBOX' },
        { accounts: [{ account: 'jane@atlas.example' }, { account: 'jane@example.com' }] },
      ),
    ],
    expected: [
      ['jane@atlas.example', undefined],
      ['2 accounts', 'INBOX'],
    ],
  })

  assert({
    given: 'a failed Google call, and another tool whose result happens to carry accounts',
    should: 'name no account and leave both subjects as the call gave them',
    actual: [
      ended('google_read', { target: 'abc' }, { success: false, error: 'not found' }),
      ended('calendar_schedule', { request: 'Lunch Friday' }, { accounts: ['jane@atlas.example', 'jane@example.com'] }),
    ],
    expected: [
      [undefined, 'abc'],
      [undefined, 'Lunch Friday'],
    ],
  })

  const history: ModelMessage[] = [
    { role: 'user', content: 'Read the plan' },
    {
      role: 'assistant',
      content: [{ type: 'tool-call', toolCallId: 'c', toolName: 'google_read', input: { target: 'abc' } }],
    },
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'c',
          toolName: 'google_read',
          output: { type: 'json', value: { success: true, account: 'jane@atlas.example' } },
        },
      ],
    },
  ]
  const rebuilt = toolRunsFromMessages(history)
  assert({
    given: 'an older snapshot that only kept the provider history, and a run saved and read back',
    should: 'name the account on the rebuilt run, and keep it through a restart',
    actual: [
      rebuilt.map((run) => [run.account, run.subject]),
      restoreToolRuns(JSON.parse(JSON.stringify(rebuilt)))?.map((run) => run.account),
    ],
    expected: [[['jane@atlas.example', 'abc']], ['jane@atlas.example']],
  })
})
