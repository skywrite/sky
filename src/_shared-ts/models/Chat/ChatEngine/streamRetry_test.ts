import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModelV4StreamPart, LanguageModelV4StreamResult } from '@ai-sdk/provider'
import { APICallError, jsonSchema, simulateReadableStream, streamText, wrapLanguageModel } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { assert, test } from '#test'
import ChatEngine, { type ChatEngineEvent, TurnError } from './mod.ts'
import { streamRetryMiddleware } from './streamRetry.ts'

const options = { instructions: ['Test assistant.'], tools: {}, toolApproval: {} }
const failure = (message = 'The example provider is busy.', isRetryable = true) => ({
  message,
  statusCode: isRetryable ? 503 : 400,
  isRetryable,
})
const finish = (unified: 'stop' | 'tool-calls' | 'error'): LanguageModelV4StreamPart => ({
  type: 'finish',
  finishReason: { unified, raw: undefined },
  usage: {
    inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 1, text: 1, reasoning: 0 },
  },
})
function step(parts: LanguageModelV4StreamPart[]): LanguageModelV4StreamResult {
  return {
    stream: simulateReadableStream({
      chunks: [{ type: 'stream-start', warnings: [] }, ...parts],
      initialDelayInMs: null,
      chunkDelayInMs: null,
    }),
  }
}
const answer = () =>
  step([
    { type: 'text-start', id: 'answer' },
    { type: 'text-delta', id: 'answer', delta: 'The example is saved.' },
    { type: 'text-end', id: 'answer' },
    finish('stop'),
  ])

test('chat retries only the failed model step and keeps completed tools and successful output once', async () => {
  let writes = 0
  const events: ChatEngineEvent[] = []
  const model = new MockLanguageModelV4({
    doStream: [
      step([{ type: 'tool-call', toolCallId: 'save-one', toolName: 'save', input: '{}' }, finish('tool-calls')]),
      step([
        { type: 'reasoning-start', id: 'discarded' },
        { type: 'reasoning-delta', id: 'discarded', delta: 'Discarded reasoning.' },
        { type: 'error', error: failure() },
      ]),
      step([{ type: 'error', error: failure() }]),
      answer(),
    ],
  })
  const engine = new ChatEngine({
    model: { model },
    approvalHandler: async () => ({ approved: false, reason: 'Unused.' }),
    onEvent: (event) => events.push(event),
  })
  engine.appendUserMessage('Save the example.')
  const result = await engine.runTurn({
    ...options,
    tools: {
      save: {
        inputSchema: jsonSchema({ type: 'object', properties: {} }),
        execute: async () => {
          writes++
          return { saved: true }
        },
      },
    },
  })
  const prompts = model.doStreamCalls.slice(1).map((call) => JSON.stringify(call.prompt))
  assert({
    given: 'a completed write followed by two transient failures while preparing its reply',
    should: 'retry the same request twice, keep the tool receipt, and return a successful reply without stale errors',
    actual: {
      writes,
      calls: model.doStreamCalls.length,
      identical: prompts.every((prompt) => prompt === prompts[0]),
      receipt: prompts.every((prompt) => prompt.includes('save-one')),
      text: result.text,
      streamed: events.flatMap((event) => (event.type === 'text-delta' ? [event.text] : [])).join(''),
      discarded: JSON.stringify(engine.snapshotMessages()).includes('Discarded reasoning'),
      tools: result.toolRecords.map((record) => record.outcome),
      completed: events.at(-1)?.type,
    },
    expected: {
      writes: 1,
      calls: 4,
      identical: true,
      receipt: true,
      text: 'The example is saved.',
      streamed: 'The example is saved.',
      discarded: false,
      tools: ['ok'],
      completed: 'turn-complete',
    },
  })
})

test('stream retries back off, stop at their limit, and preserve the final provider error', async () => {
  const waits: number[] = []
  let attempts = 0
  const model = new MockLanguageModelV4({
    doStream: async () => step([{ type: 'error', error: failure(`Example failure ${++attempts}.`) }]),
  })
  const wrapped = wrapLanguageModel({
    model,
    middleware: streamRetryMiddleware({ wait: async (ms) => void waits.push(ms) }),
  })
  let message: string | undefined
  const result = streamText({
    model: wrapped,
    prompt: 'Read the example.',
    onError: ({ error }) => {
      message = (error as Error).message
    },
  })
  await result.consumeStream()
  assert({
    given: 'a provider that remains unavailable',
    should: 'make three attempts with increasing delays and surface the last error',
    actual: [attempts, waits, message],
    expected: [3, [1000, 2000], 'Example failure 3.'],
  })
})

test('permanent failures and output already in progress never replay a model step', async () => {
  const scenarios: Array<{ name: string; parts: LanguageModelV4StreamPart[] }> = [
    { name: 'invalid input', parts: [{ type: 'error', error: failure('Invalid example input.', false) }] },
    {
      name: 'quota exhausted',
      parts: [{ type: 'error', error: { ...failure('Example quota exhausted.', false), statusCode: 429 } }],
    },
    { name: 'unknown failure', parts: [{ type: 'error', error: new Error('Unclassified example failure.') }] },
    {
      name: 'partial text',
      parts: [
        { type: 'text-start', id: 'partial' },
        { type: 'text-delta', id: 'partial', delta: 'Partial example answer.' },
        { type: 'error', error: failure() },
      ],
    },
    {
      name: 'tool arguments',
      parts: [
        { type: 'tool-input-start', id: 'pending', toolName: 'save' },
        { type: 'error', error: failure() },
      ],
    },
    {
      name: 'provider tool',
      parts: [
        { type: 'tool-call', toolCallId: 'hosted', toolName: 'lookup', input: '{}', providerExecuted: true },
        { type: 'error', error: failure() },
      ],
    },
  ]
  for (const scenario of scenarios) {
    const model = new MockLanguageModelV4({ doStream: async () => step(scenario.parts) })
    const wrapped = wrapLanguageModel({
      model,
      middleware: streamRetryMiddleware({ wait: async () => {} }),
    })
    const result = await wrapped.doStream({ prompt: [] })
    const parts = await Array.fromAsync(result.stream)
    assert({
      given: scenario.name,
      should: 'preserve its output and error without retrying',
      actual: [model.doStreamCalls.length, parts.slice(1)],
      expected: [1, scenario.parts],
    })
  }
})

test('Stop cancels the retry delay without starting another request', async () => {
  const controller = new AbortController()
  const model = new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream({
        start(stream) {
          stream.enqueue({ type: 'stream-start', warnings: [] })
          stream.enqueue({ type: 'error', error: failure() })
        },
        cancel() {
          setTimeout(() => controller.abort(), 10)
        },
      }),
    }),
  })
  const engine = new ChatEngine({
    model: { model },
    approvalHandler: async () => ({ approved: false, reason: 'Unused.' }),
  })
  engine.appendUserMessage('Read the example.')
  const result = await engine.runTurn({ ...options, abortSignal: controller.signal })
  assert({
    given: 'Stop during the delay after a failed stream is released for retry',
    should: 'return the stopped reply and make no further provider calls',
    actual: [result.stopped, model.doStreamCalls.length],
    expected: [true, 1],
  })
})

test('a failed retry connection does not reset the retry allowance', async () => {
  let attempts = 0
  const model = new MockLanguageModelV4({
    doStream: async () => {
      if (++attempts === 1) return step([{ type: 'error', error: failure() }])
      throw new APICallError({
        message: 'Example connection unavailable.',
        url: 'https://example.com/model',
        requestBodyValues: {},
        statusCode: 503,
      })
    },
  })
  const wrapped = wrapLanguageModel({ model, middleware: streamRetryMiddleware({ wait: async () => {} }) })
  let error: unknown
  const result = streamText({
    model: wrapped,
    prompt: 'Read the example.',
    onError: (event) => void (error = event.error),
  })
  await result.consumeStream()
  assert({
    given: 'a transient stream error followed by a failed connection',
    should: 'surface the connection failure without restarting the entire retry loop',
    actual: [attempts, (error as Error)?.message],
    expected: [2, 'Example connection unavailable.'],
  })
})

test('OpenAI response.failed after reasoning starts recovers through the real provider adapter', async () => {
  let calls = 0
  const provider = createOpenAI({
    apiKey: 'test-key',
    fetch: (async (_input, _init) => {
      const failed = ++calls === 1
      const events = failed
        ? [
            { type: 'response.output_item.added', output_index: 0, item: { type: 'reasoning', id: 'discarded' } },
            {
              type: 'response.failed',
              sequence_number: 1,
              response: { error: { code: 'server_error', message: 'Example processing failure.' } },
            },
          ]
        : [
            { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'answer' } },
            { type: 'response.output_text.delta', item_id: 'answer', delta: 'The example is saved.' },
            { type: 'response.output_item.done', output_index: 0, item: { type: 'message', id: 'answer' } },
            { type: 'response.completed', response: {} },
          ]
      return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
        headers: { 'content-type': 'text/event-stream' },
      })
    }) as typeof fetch,
  })
  const engine = new ChatEngine({
    model: { model: provider('test-model') },
    approvalHandler: async () => ({ approved: false, reason: 'Unused.' }),
  })
  engine.appendUserMessage('Read the example.')
  const result = await engine.runTurn(options)
  assert({
    given: 'a structured provider error after its early HTTP retry window',
    should: 'use the provider retry metadata and return only the recovered reply',
    actual: [calls, result.text, JSON.stringify(engine.snapshotMessages()).includes('discarded')],
    expected: [2, 'The example is saved.', false],
  })
})

test('chat with retries disabled retains the original failure', async () => {
  const model = new MockLanguageModelV4({ doStream: async () => step([{ type: 'error', error: failure() }]) })
  const engine = new ChatEngine({
    model: { model, maxRetries: 0 },
    approvalHandler: async () => ({ approved: false, reason: 'Unused.' }),
  })
  engine.appendUserMessage('Read the example.')
  let error: unknown
  try {
    await engine.runTurn(options)
  } catch (caught) {
    error = caught
  }
  assert({
    given: 'an explicit zero retry policy',
    should: 'attempt the request once and preserve the provider message in its TurnError',
    actual: [model.doStreamCalls.length, error instanceof TurnError && error.message],
    expected: [1, 'The example provider is busy.'],
  })
})
