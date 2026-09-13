import { jsonSchema, simulateReadableStream } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { assert, test } from '#test'
import ChatEngine, { type ModelInvocation } from './mod.ts'

const options = { instructions: ['Test assistant.'], tools: {}, toolApproval: {} }
const empty: ModelInvocation = { text: '', content: [], steps: [], responseMessages: [] }

test('Stop aborts the provider stream, retains the partial reply, and permits the next turn', async () => {
  const controller = new AbortController()
  let providerSignal: AbortSignal | undefined
  const model = new MockLanguageModelV3({
    doStream: async ({ abortSignal }) => {
      if (!providerSignal) {
        providerSignal = abortSignal
        return {
          stream: new ReadableStream({
            start(stream) {
              stream.enqueue({ type: 'stream-start', warnings: [] })
              stream.enqueue({ type: 'text-start', id: 'reply' })
              stream.enqueue({ type: 'text-delta', id: 'reply', delta: 'A partial answer.' })
              abortSignal?.addEventListener('abort', () => stream.error(abortSignal.reason), { once: true })
            },
          }),
        }
      }
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: 'stream-start', warnings: [] },
            { type: 'text-start', id: 'next' },
            { type: 'text-delta', id: 'next', delta: 'A fresh answer.' },
            { type: 'text-end', id: 'next' },
            {
              type: 'finish',
              finishReason: { unified: 'stop', raw: undefined },
              usage: {
                inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
                outputTokens: { total: 1, text: 1, reasoning: 0 },
              },
            },
          ],
        }),
      }
    },
  })
  const engine = new ChatEngine({
    model: { model },
    approvalHandler: async () => ({ approved: false, reason: 'Unused.' }),
    onEvent: (event) => {
      if (event.type === 'text-delta' && event.text === 'A partial answer.') controller.abort()
    },
  })
  engine.appendUserMessage('Start a long answer.')
  const stopped = await engine.runTurn({ ...options, abortSignal: controller.signal })
  engine.appendUserMessage('Try something else.')
  const next = await engine.runTurn(options)
  assert({
    given: 'Stop during the actual SDK streaming path',
    should: 'abort the provider, retain its partial text in history, and use a fresh signal next time',
    actual: [
      providerSignal?.aborted,
      stopped.stopped,
      stopped.text,
      next.text,
      JSON.stringify(model.doStreamCalls[1].prompt).includes('Response stopped.'),
    ],
    expected: [true, true, 'A partial answer.\n\n*Response stopped.*', 'A fresh answer.', true],
  })
})

test('Stop releases an approval wait and keeps completed tools without replaying unfinished calls', async () => {
  const controller = new AbortController()
  let calls = 0
  const engine = new ChatEngine({
    model: {} as ConstructorParameters<typeof ChatEngine>[0]['model'],
    approvalHandler: () => {
      controller.abort()
      return new Promise(() => {})
    },
    invokeModel: async () => {
      calls++
      return {
        ...empty,
        text: 'I found the draft.',
        steps: [{ toolResults: [{ toolName: 'read_draft', toolCallId: 'read', input: {}, output: 'Draft text.' }] }],
        content: [
          {
            type: 'tool-approval-request',
            approvalId: 'approval',
            toolCall: { toolName: 'send_draft', toolCallId: 'send', input: {} },
          },
        ],
        responseMessages: [
          {
            role: 'assistant',
            content: [{ type: 'tool-call', toolCallId: 'read', toolName: 'read_draft', input: {} }],
          },
          {
            role: 'tool',
            content: [
              {
                type: 'tool-result',
                toolCallId: 'read',
                toolName: 'read_draft',
                output: { type: 'text', value: 'Draft text.' },
              },
            ],
          },
          {
            role: 'assistant',
            content: [
              { type: 'tool-call', toolCallId: 'send', toolName: 'send_draft', input: {} },
              { type: 'tool-approval-request', approvalId: 'approval', toolCallId: 'send' },
            ],
          },
        ],
      }
    },
  })
  engine.appendUserMessage('Prepare a draft.')
  const stopped = await engine.runTurn({ ...options, abortSignal: controller.signal })
  const history = engine.snapshotMessages()
  assert({
    given: 'a completed read and a pending send approval when stopped',
    should: 'retain the completed result, remove the unfinished protocol, and never invoke a continuation',
    actual: [
      stopped.stopped,
      calls,
      stopped.toolRecords.map((tool) => tool.tool),
      history.map((message) => message.role),
      JSON.stringify(history).includes('Draft text.'),
      JSON.stringify(history).includes('send_draft'),
    ],
    expected: [true, 1, ['read_draft'], ['user', 'assistant', 'tool', 'assistant'], true, false],
  })
})

test('A turn stopped before generation never calls the model', async () => {
  const controller = new AbortController()
  controller.abort()
  let called = false
  const engine = new ChatEngine({
    model: {} as ConstructorParameters<typeof ChatEngine>[0]['model'],
    approvalHandler: async () => ({ approved: false, reason: 'Unused.' }),
    invokeModel: async () => {
      called = true
      return empty
    },
  })
  engine.appendUserMessage('Start.')
  const result = await engine.runTurn({ ...options, abortSignal: controller.signal })
  assert({
    given: 'Stop before the first model call',
    should: 'finish with a stopped reply without invoking the model',
    actual: [called, result.stopped, result.text],
    expected: [false, true, '*Response stopped.*'],
  })
})

test('Stop waits for an existing write to settle and retains its result without starting another step', async () => {
  const controller = new AbortController()
  const started = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const model = new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'stream-start', warnings: [] },
          { type: 'tool-call', toolCallId: 'write', toolName: 'write_mock', input: '{}' },
          {
            type: 'finish',
            finishReason: { unified: 'tool-calls', raw: undefined },
            usage: {
              inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 1, text: 1, reasoning: 0 },
            },
          },
        ],
      }),
    }),
  })
  let toolSignal: AbortSignal | undefined
  const engine = new ChatEngine({
    model: { model },
    approvalHandler: async () => ({ approved: true, reason: 'Unused.' }),
  })
  engine.appendUserMessage('Create the mock draft.')
  let settled = false
  const pending = engine
    .runTurn({
      ...options,
      abortSignal: controller.signal,
      tools: {
        write_mock: {
          inputSchema: jsonSchema({ type: 'object', properties: {} }),
          execute: async (_input: unknown, options: { abortSignal?: AbortSignal }) => {
            toolSignal = options.abortSignal
            started.resolve()
            await release.promise
            return { file: 'https://example.com/draft' }
          },
        },
      },
    })
    .then((result) => {
      settled = true
      return result
    })
  await started.promise
  controller.abort()
  await new Promise((resolve) => setTimeout(resolve, 10))
  const waiting = !settled
  release.resolve()
  const result = await pending
  const history = JSON.stringify(engine.snapshotMessages())
  assert({
    given: 'Stop after a write began that cannot itself be interrupted',
    should: 'hold the turn until it settles, retain the result, and prevent the next model step',
    actual: [
      waiting,
      toolSignal?.aborted,
      result.stopped,
      model.doStreamCalls.length,
      history.includes('https://example.com/draft'),
      result.toolRecords.map((record) => record.tool),
    ],
    expected: [true, true, true, 1, true, ['write_mock']],
  })
})
