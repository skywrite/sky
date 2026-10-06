import { Buffer } from 'node:buffer'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import {
  APICallError,
  generateText,
  jsonSchema,
  type ModelMessage,
  simulateReadableStream,
  wrapLanguageModel,
} from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { InputTokenLimitError, withAnthropicTokenCount, withOpenAITokenCount } from '#shared/ai/inputTokenLimit.ts'
import { assert, test } from '#test'
import ChatEngine, { type ChatEngineEvent } from './mod.ts'
import { requestBudgetMiddleware } from './requestBudget.ts'
import { NOTEBOOK_ADDITION, WorkingContext } from './workingContext.ts'

function step(parts: unknown[], unified: 'tool-calls' | 'stop') {
  return {
    stream: simulateReadableStream<any>({
      chunks: [
        { type: 'stream-start', warnings: [] },
        ...parts,
        {
          type: 'finish',
          finishReason: { unified, raw: undefined },
          usage: {
            inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 1, text: 1, reasoning: 0 },
          },
        },
      ],
    }),
  }
}

const reply = () =>
  step(
    [
      { type: 'text-start', id: 't' },
      { type: 'text-delta', id: 't', delta: 'The sources agree.' },
      { type: 'text-end', id: 't' },
    ],
    'stop',
  )

test('OpenAI can inspect a large native image tool result without counting base64 as prose', async () => {
  const image = Buffer.alloc(1_800_000, 1).toString('base64')
  const messages: ModelMessage[] = [
    { role: 'user', content: 'Make the center of the Atlas diagram green, preserving the layout.' },
    {
      role: 'assistant',
      content: [
        { type: 'tool-call', toolCallId: 'read-image', toolName: 'read_file', input: { path: '/mock/Atlas.png' } },
      ],
    },
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'read-image',
          toolName: 'read_file',
          output: {
            type: 'content',
            value: [
              { type: 'text', text: 'File: /mock/Atlas.png\nSaved copy: /mock/Archive/Atlas.png' },
              { type: 'file', mediaType: 'image/png', data: { type: 'data', data: image } },
            ],
          },
        },
      ],
    },
  ]
  const original = JSON.stringify(messages)
  const calls: Array<{ count: boolean; image: boolean; question: boolean }> = []
  const adjustments: unknown[] = []
  const provider = createOpenAI({
    apiKey: 'test-key',
    fetch: withOpenAITokenCount((async (url, init) => {
      const body = init!.body as string
      const count = String(url).endsWith('/input_tokens')
      calls.push({
        count,
        image: body.includes(`data:image/png;base64,${image}`),
        question: body.includes('preserving the layout'),
      })
      return count
        ? Response.json({ input_tokens: 2000 })
        : Response.json({
            id: 'response-example',
            model: 'test-model',
            output: [
              {
                type: 'message',
                id: 'message-example',
                role: 'assistant',
                content: [{ type: 'output_text', text: 'The image is ready for editing.', annotations: [] }],
              },
            ],
            usage: { input_tokens: 2000, output_tokens: 8 },
          })
    }) as typeof fetch),
  })
  const result = await generateText({
    model: wrapLanguageModel({
      model: provider('test-model'),
      middleware: requestBudgetMiddleware({ contextWindow: 10000, onAdjustment: (value) => adjustments.push(value) }),
    }),
    messages,
    maxOutputTokens: 200,
  })
  assert({
    given: 'a freshly read diagram whose encoding exceeds a million characters but native input fits',
    should: 'send the full image to counting and generation, preserve history, and avoid unnecessary compaction',
    actual: [result.text, calls, adjustments.length, JSON.stringify(messages) === original],
    expected: [
      'The image is ready for editing.',
      [
        { count: true, image: true, question: true },
        { count: false, image: true, question: true },
      ],
      0,
      true,
    ],
  })
})

test('a long chat compacts retrieved sources across tool steps and restart without repeating an action', async () => {
  let executions = 0
  const requests: string[] = []
  const model = new MockLanguageModelV3({
    doStream: async ({ prompt }) => {
      requests.push(JSON.stringify(prompt))
      const completed = prompt.some(
        (message) =>
          message.role === 'tool' &&
          message.content.some((part) => part.type === 'tool-result' && part.toolCallId === 'store-one'),
      )
      return completed
        ? reply()
        : step([{ type: 'tool-call', toolCallId: 'store-one', toolName: 'store', input: '{}' }], 'tool-calls')
    },
  })
  const options = {
    model: { model, contextWindow: 10000, maxOutputTokens: 500 },
    approvalHandler: async () => ({ approved: false, reason: '' }),
  }
  const engine = new ChatEngine(options)
  const sources: string[] = []
  for (let i = 0; i < 8; i++) {
    const source = `${NOTEBOOK_ADDITION}\n\n${`Background source ${i}. `.repeat(500)}`
    sources.push(source)
    engine.appendContextMessage(source, [`/mock/Source-${i}.md`])
    engine.appendUserMessage(`Instruction ${i}: keep the originals.`)
    engine.seedConversation([{ role: 'assistant', content: `Step ${i} recorded.` }])
  }
  engine.appendUserMessage('Does the accountant have the wage statement?', undefined, [
    { type: 'file', data: new Uint8Array([1, 2, 3]), mediaType: 'application/pdf' },
  ])
  const tools = {
    store: {
      inputSchema: jsonSchema<Record<string, never>>({ type: 'object', properties: {} }),
      execute: async () => {
        executions++
        return {
          success: true,
          receipt: 'example-receipt-123',
          path: '/mock/Done/statement.pdf',
          text: 'Old tool details. '.repeat(2000),
        }
      },
    },
  }
  const instructions = ['The task is paused. Downloaded and uploaded are separate facts. Keep all original documents.']
  const result = await engine.runTurn({ instructions, tools, toolApproval: {} })
  const raw = engine.snapshotMessages()
  const restored = new ChatEngine(options)
  restored.seedConversation([], raw)
  restored.workingContext = new WorkingContext(JSON.parse(JSON.stringify(engine.workingContext.state)))
  restored.appendUserMessage('Which receipt confirmed it?')
  const again = await restored.runTurn({ instructions, tools, toolApproval: {} })
  assert({
    given: 'a large multi-turn source history, a successful action, an oversized result and a restart',
    should:
      'answer twice with one action, preserve all user instructions and raw evidence, and reuse compacted requests',
    actual: [
      result.text,
      again.text,
      executions,
      engine.workingContext.compactedSources > 0,
      requests.every((request) =>
        Array.from({ length: 8 }, (_, i) => `Instruction ${i}: keep the originals.`).every((instruction) =>
          request.includes(instruction),
        ),
      ),
      requests.every((request) => request.includes('The task is paused.')),
      requests.at(-1)?.includes('example-receipt-123'),
      requests.at(-1)?.includes('application/pdf'),
      sources.every((source) => JSON.stringify(raw).includes(JSON.stringify(source).slice(1, -1))),
      JSON.stringify(raw).includes('Old tool details. '.repeat(2000)),
      requests.at(-1)!.length < JSON.stringify(raw).length,
    ],
    expected: ['The sources agree.', 'The sources agree.', 1, true, true, true, true, true, true, true, true],
  })
})

test('headroom does not reject irreducible user input that fits the actual window', async () => {
  let calls = 0
  const engine = new ChatEngine({
    model: {
      model: new MockLanguageModelV3({
        doStream: async () => {
          calls++
          return reply()
        },
      }),
      contextWindow: 3000,
      maxOutputTokens: 200,
    },
    approvalHandler: async () => ({ approved: false, reason: '' }),
  })
  engine.appendUserMessage('x'.repeat(4800))
  const result = await engine.runTurn({ instructions: [], tools: {}, toolApproval: {} })
  assert({
    given: 'user text over the working target but under the hard limit',
    should: 'preserve it and answer without extra generations',
    actual: [calls, result.text],
    expected: [1, 'The sources agree.'],
  })
})

test('the real Claude adapter counts and refits before its first generation request', async () => {
  let counts = 0
  let generations = 0
  const order: string[] = []
  const provider = createAnthropic({
    apiKey: 'test-key',
    fetch: withAnthropicTokenCount((async (url, init) => {
      const body = JSON.parse(init!.body as string)
      if (String(url).includes('/count_tokens')) {
        counts++
        order.push('count')
        return Response.json({ input_tokens: Math.ceil(JSON.stringify(body).length / 2) })
      }
      generations++
      order.push('generate')
      const events = [
        {
          type: 'message_start',
          message: {
            id: 'm',
            type: 'message',
            role: 'assistant',
            model: 'test-model',
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 1, output_tokens: 0 },
          },
        },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'The request fits.' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 4 } },
        { type: 'message_stop' },
      ]
      return new Response(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), {
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }) as typeof fetch),
  })
  const engine = new ChatEngine({
    model: { model: provider('claude-fable-5-1'), contextWindow: 6000, maxOutputTokens: 500 },
    approvalHandler: async () => ({ approved: false, reason: '' }),
  })
  const notebook = 'Source text. '.repeat(1500)
  engine.appendUserMessage('Summarize the source.')
  const result = await engine.runTurn({
    instructions: ['Standing instructions.', notebook],
    notebook: {
      instructions: notebook,
      tokens: notebook.length / 4,
      fit: (tokens) => ({ instructions: notebook.slice(0, tokens * 4), tokens }),
    },
    tools: {},
    toolApproval: {},
  })
  assert({
    given: 'SDK serialization, provider counting and the chat guard together',
    should: 'fit using count-only requests before starting one successful generation',
    actual: {
      reply: result.text,
      recounted: counts > 1,
      generations,
      countedFirst: order.slice(0, -1).every((kind) => kind === 'count'),
    },
    expected: { reply: 'The request fits.', recounted: true, generations: 1, countedFirst: true },
  })
})

test('chat refits before each model step without rerunning tools or changing retained history', async () => {
  const events: ChatEngineEvent[] = []
  const accepted: string[] = []
  let executions = 0
  const source = 'Evidence from https://example.com/report. '.repeat(1200)
  const model = new MockLanguageModelV3({
    provider: 'anthropic.messages',
    doStream: async ({ prompt }) => {
      const input = JSON.stringify(prompt)
      // A synthetic provider whose tokenizer differs materially from chars/4.
      const tokens = Math.ceil(input.length / 2)
      if (tokens > 6000) throw new InputTokenLimitError(tokens, 6000)
      accepted.push(input)
      return prompt.some((message) => message.role === 'tool')
        ? reply()
        : step([{ type: 'tool-call', toolCallId: 'read-one', toolName: 'read', input: '{}' }], 'tool-calls')
    },
  })
  const engine = new ChatEngine({
    model: { model, contextWindow: 8000, maxOutputTokens: 200 },
    approvalHandler: async () => ({ approved: false, reason: 'No writes' }),
    onEvent: (event) => events.push(event),
  })
  const originalNotebook = 'Notebook evidence. '.repeat(1400)
  const fits: number[] = []
  engine.appendUserMessage('Summarize all sources, preserving the disagreement.')
  const result = await engine.runTurn({
    instructions: ['Standing rule: cite the evidence.', originalNotebook],
    notebook: {
      instructions: originalNotebook,
      tokens: Math.ceil(originalNotebook.length / 4),
      fit: (tokens) => {
        fits.push(tokens)
        // Pinned instructions cannot be reduced below this small spine.
        const instructions = originalNotebook.slice(0, Math.max(100, tokens) * 4)
        return { instructions, tokens: Math.ceil(instructions.length / 4) }
      },
    },
    tools: {
      read: {
        inputSchema: jsonSchema<Record<string, never>>({ type: 'object', properties: {} }),
        execute: async () => {
          executions++
          return source
        },
      },
    },
    toolApproval: {},
  })
  assert({
    given: 'oversized notebook reading followed by a tool result larger than the remaining window',
    should: 'finish within capacity, keep the question and instructions, and preserve the original result',
    actual: {
      reply: result.text,
      executions,
      calls: accepted.length,
      refitted: fits.length > 0,
      intact: accepted.every(
        (text) => text.includes('Standing rule: cite the evidence.') && text.includes('preserving the disagreement'),
      ),
      excerpts: accepted.at(-1)?.includes('Tool result shortened'),
      retained: JSON.stringify(engine.snapshotMessages()).includes(source),
      disclosed: events.some(
        (event) => event.type === 'context-adjusted' && event.adjustment.shortenedToolResults === 1,
      ),
    },
    expected: {
      reply: 'The sources agree.',
      executions: 1,
      calls: 2,
      refitted: true,
      intact: true,
      excerpts: true,
      retained: true,
      disclosed: true,
    },
  })
})

test('a provider overflow is recovered at the failed request, and unrelated errors are not retried', async () => {
  let requests = 0
  const model = new MockLanguageModelV3({
    provider: 'anthropic.messages',
    doStream: async () => {
      if (requests++ === 0)
        throw new APICallError({
          url: 'https://example.com/messages',
          requestBodyValues: {},
          statusCode: 400,
          message: 'prompt is too long: 9000 tokens > 8000 maximum',
          responseBody: '{"error":{"message":"prompt is too long: 9000 tokens > 8000 maximum"}}',
        })
      return reply()
    },
  })
  const engine = new ChatEngine({
    model: { model, maxOutputTokens: 200 },
    approvalHandler: async () => ({ approved: false, reason: '' }),
  })
  engine.appendUserMessage('Summarize the report.')
  const context = 'Reading. '.repeat(3000)
  const result = await engine.runTurn({
    instructions: [context],
    notebook: {
      instructions: context,
      tokens: context.length / 4,
      fit: (tokens) => ({ instructions: context.slice(0, tokens * 4), tokens }),
    },
    tools: {},
    toolApproval: {},
  })
  assert({
    given: 'an undeclared model window or an unavailable token counter',
    should: 'learn from a context rejection and recover',
    actual: [requests, result.text],
    expected: [2, 'The sources agree.'],
  })

  let failures = 0
  engine.setModel({
    model: new MockLanguageModelV3({
      doStream: async () => {
        failures++
        throw new Error('Authentication failed')
      },
    }),
    maxRetries: 0,
  })
  engine.appendUserMessage('Continue.')
  let error = ''
  try {
    await engine.runTurn({ instructions: [], tools: {}, toolApproval: {} })
  } catch (err) {
    error = (err as Error).message
  }
  assert({
    given: 'an unrelated provider failure',
    should: 'surface it once without changing context',
    actual: [failures, error],
    expected: [1, 'Authentication failed'],
  })
})

test('an oversized user message is preserved and receives an actionable capacity error', async () => {
  let requests = 0
  const model = new MockLanguageModelV3({
    doStream: async () => {
      requests++
      return reply()
    },
  })
  const engine = new ChatEngine({
    model: { model, contextWindow: 2000, maxOutputTokens: 200 },
    approvalHandler: async () => ({ approved: false, reason: '' }),
  })
  const message = 'Complete user request. '.repeat(1000)
  engine.appendUserMessage(message)
  let error = ''
  try {
    await engine.runTurn({ instructions: [], tools: {}, toolApproval: {} })
  } catch (err) {
    error = (err as Error).message
  }
  assert({
    given: 'a message too large even without notebook reading or tool results',
    should: 'avoid sending it or silently deleting it, and explain the next action',
    actual: {
      requests,
      retained: JSON.stringify(engine.snapshotMessages()).includes(message),
      actionable: error.includes('larger context window'),
    },
    expected: { requests: 0, retained: true, actionable: true },
  })
})
