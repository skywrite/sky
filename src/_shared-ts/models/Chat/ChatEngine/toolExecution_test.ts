import { assert, test } from '#test'
import { observeTools, ToolProgress, type ToolExecutionEvent } from './toolExecution.ts'

test('A quiet tool reports its inputs before completion and returns its exact result', async () => {
  const events: ToolExecutionEvent[] = []
  let release!: (value: unknown) => void
  const pending = new Promise((resolve) => {
    release = resolve
  })
  const original = { message: 'Ready.' }
  const tools = observeTools(
    {
      quiet: {
        execute: async (input: unknown, _options: unknown) => {
          assert({
            given: 'a wrapped tool',
            should: 'receive the original input unchanged',
            actual: input,
            expected: original,
          })
          return pending
        },
      },
    },
    (event) => events.push(event),
  )
  const result = tools.quiet.execute(original, { toolCallId: 'call-one' })
  assert({
    given: 'a tool that is still waiting and prints no lines',
    should: 'already expose its input and running state',
    actual: events.map((event) => [event.type, event.toolCallId, 'input' in event ? event.input : undefined]),
    expected: [['tool-execution-start', 'call-one', original]],
  })
  release({ success: true, draft: 'Ready.' })
  assert({
    given: 'the completed tool',
    should: 'return its result and report completion with the same ID',
    actual: [await result, events[1].type, events[1].toolCallId],
    expected: [{ success: true, draft: 'Ready.' }, 'tool-execution-end', 'call-one'],
  })
})

test('A thrown tool error is observable and still propagates to the engine', async () => {
  const events: ToolExecutionEvent[] = []
  const error = new Error('The test model timed out.')
  const tools = observeTools(
    {
      quiet: {
        execute: async () => {
          throw error
        },
      },
    },
    (event) => events.push(event),
  )
  let caught: unknown
  try {
    await tools.quiet.execute()
  } catch (failure) {
    caught = failure
  }
  const last = events.at(-1)!
  assert({
    given: 'a failed tool',
    should: 'preserve the error and end its live activity',
    actual: [caught === error, last.type, 'error' in last ? last.error : undefined],
    expected: [true, 'tool-execution-end', error.message],
  })
})

test('Streamed results and late input callbacks cannot restart or duplicate a completed tool', () => {
  const events: ToolExecutionEvent[] = []
  const progress = new ToolProgress((event) => events.push(event))
  progress.start('one', 'future_tool', 'running', { task: 'Read the sample.' })
  progress.chunk({ type: 'tool-input-start', id: 'one', toolName: 'future_tool' })
  progress.end('one', 'future_tool', { output: 'Ready.' })
  progress.chunk({ type: 'tool-result', toolCallId: 'one', toolName: 'future_tool', input: {}, output: 'Ready.' })
  progress.chunk({ type: 'tool-call', toolCallId: 'one', toolName: 'future_tool', input: {} })
  progress.finishIncomplete('Interrupted')
  assert({
    given: 'execution followed by delayed SDK stream callbacks',
    should: 'show just one running indicator and one completion',
    actual: events.map((event) => event.type),
    expected: ['tool-execution-start', 'tool-execution-end'],
  })
})

test('Every open call ends on interruption, while preliminary provider results stay running', () => {
  const events: ToolExecutionEvent[] = []
  const progress = new ToolProgress((event) => events.push(event))
  progress.chunk({
    type: 'tool-call',
    toolCallId: 'provider',
    toolName: 'hosted_lookup',
    input: {},
    providerExecuted: true,
  })
  progress.chunk({
    type: 'tool-result',
    toolCallId: 'provider',
    toolName: 'hosted_lookup',
    input: {},
    output: 'Partial',
    preliminary: true,
  })
  progress.start('waiting', 'future_tool', 'waiting', {})
  progress.start('invalid', 'future_tool', 'preparing')
  progress.chunk({
    type: 'tool-error',
    toolCallId: 'invalid',
    toolName: 'future_tool',
    input: {},
    error: new Error('Invalid input'),
  })
  progress.finishIncomplete('The turn failed.')
  assert({
    given: 'a provider tool, an approval wait, and invalid arguments',
    should: 'finish every call with an honest outcome even when no local executor runs',
    actual: events
      .filter((event) => event.type === 'tool-execution-end')
      .map((event) => [event.toolCallId, event.error]),
    expected: [
      ['invalid', 'Invalid input'],
      ['provider', 'The turn failed.'],
      ['waiting', 'The turn failed.'],
    ],
  })
})
