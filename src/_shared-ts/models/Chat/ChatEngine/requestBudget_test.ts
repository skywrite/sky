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
    model: { model: provider('claude-fable-5-2'), contextWindow: 6000, maxOutputTokens: 500 },
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

// ---------------------------------------------------------------------------
// Compaction: room made once, in order, and kept
// ---------------------------------------------------------------------------

/** A model with a 200,000-token window that counts two characters a token and records what it accepted. */
function countingModel(answer: (prompt: unknown[]) => ReturnType<typeof reply> = reply) {
  const accepted: string[] = []
  const model = new MockLanguageModelV3({
    doStream: async ({ prompt }) => {
      accepted.push(JSON.stringify(prompt))
      return answer(prompt)
    },
  })
  const events: ChatEngineEvent[] = []
  const engine = new ChatEngine({
    model: { model, contextWindow: 200_000, maxOutputTokens: 200 },
    approvalHandler: async () => ({ approved: false, reason: '' }),
    onEvent: (event) => events.push(event),
  })
  const adjustments = () => events.flatMap((event) => (event.type === 'context-adjusted' ? [event.adjustment] : []))
  return { engine, accepted, adjustments }
}

/** What the request may hold under the working target, in the counting model's tokens. */
const LIMIT = 170_000 - 200 - 1_700
const tokensOf = (request: string) => Math.ceil(request.length / 2)
const lookup = (i: number) => `Lookup ${i}: ${`Atlas record ${i} line. `.repeat(300)}`.slice(0, 6000)
const lookups = (count: number): ModelMessage[] =>
  Array.from({ length: count }, (_, i): ModelMessage[] => [
    {
      role: 'assistant',
      content: [{ type: 'tool-call', toolCallId: `call-${i}`, toolName: 'lookup', input: { id: i } }],
    },
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: `call-${i}`,
          toolName: 'lookup',
          output: { type: 'text', value: lookup(i) },
        },
      ],
    },
  ]).flat()

test('a chat full of tool results is compacted once: older results go, the newest twenty stay, and the next request is the same', async () => {
  const { engine, accepted, adjustments } = countingModel()
  engine.seedConversation([], [{ role: 'user', content: 'Look up the Atlas records.' }, ...lookups(60)])
  engine.appendUserMessage('What did the records say about the demo?')
  await engine.runTurn({ instructions: ['Cite the record you used.'], tools: {}, toolApproval: {} })
  engine.appendUserMessage('And about the launch?')
  await engine.runTurn({ instructions: ['Cite the record you used.'], tools: {}, toolApproval: {} })

  const [first, second] = accepted as [string, string]
  const shortened = (request: string) => request.split('Tool result shortened').length - 1
  const intact = (request: string, i: number) => request.includes(JSON.stringify(lookup(i)).slice(1, -1))
  const [adjustment] = adjustments()
  assert({
    given: 'sixty tool results that no longer fit, then one more message',
    should:
      'clear the oldest results in one step, leave a quarter of the room free, keep the newest twenty whole, say what it cleared, and send the same cleared results again without compacting a second time',
    actual: {
      requests: accepted.length,
      compactions: adjustments().length,
      cleared: adjustment?.compacted?.toolResults === shortened(first) && shortened(first) > 0,
      notes: adjustment?.compacted?.notes,
      roomLeft: tokensOf(first) <= LIMIT * 0.8 && tokensOf(first) > LIMIT * 0.6,
      oldestCleared: !intact(first, 0),
      newestTwentyWhole: Array.from({ length: 20 }, (_, i) => 40 + i).every((i) => intact(first, i)),
      sameAfterwards:
        shortened(second) === shortened(first) &&
        second.startsWith(first.slice(0, first.lastIndexOf('{"role":"user"'))),
      historyKept: JSON.stringify(engine.snapshotMessages()).includes(JSON.stringify(lookup(0)).slice(1, -1)),
    },
    expected: {
      requests: 2,
      compactions: 1,
      cleared: true,
      notes: 0,
      roomLeft: true,
      oldestCleared: true,
      newestTwentyWhole: true,
      sameAfterwards: true,
      historyKept: true,
    },
  })
})

test('a chat full of notes has them cut once, to leave room, and not again on the replies that follow', async () => {
  const { engine, accepted, adjustments } = countingModel()
  const notebook = 'A note about the Atlas rollout. '.repeat(11_000).slice(0, 340_000)
  const fits: number[] = []
  let current = notebook
  const turn = () =>
    engine.runTurn({
      instructions: ['Standing rule.', current],
      notebook: {
        instructions: current,
        tokens: current.length / 4,
        documents: current.length / 400,
        fit: (tokens) => {
          fits.push(tokens)
          current = notebook.slice(0, tokens * 4)
          return { instructions: current, tokens, documents: Math.floor(tokens / 100) }
        },
      },
      tools: {},
      toolApproval: {},
    })
  engine.appendUserMessage('What is the plan?')
  await turn()
  engine.seedConversation([{ role: 'assistant', content: 'The plan is the March demo.' }])
  engine.appendUserMessage(`Here is more detail. ${'Detail. '.repeat(500)}`)
  await turn()
  engine.seedConversation([{ role: 'assistant', content: 'Noted.' }])
  engine.appendUserMessage('And the launch date?')
  await turn()

  const [adjustment] = adjustments()
  assert({
    given: 'a first reading that alone overfills the request, then two more messages that add a little',
    should:
      'cut the reading once, far enough to leave a quarter of the room, count the notes it dropped, and send the same reading on the next two requests',
    actual: {
      requests: accepted.length,
      cuts: fits.length,
      compactions: adjustments().length,
      roomLeft: tokensOf(accepted[0]!) <= LIMIT * 0.8 && tokensOf(accepted[0]!) > LIMIT * 0.6,
      notesDropped: adjustment?.compacted?.notes === 850 - Math.floor(fits[0]! / 100),
      toolResults: adjustment?.compacted?.toolResults,
      sameReading: accepted.every((request) => request.includes(current) && !request.includes(notebook)),
    },
    expected: {
      requests: 3,
      cuts: 1,
      compactions: 1,
      roomLeft: true,
      notesDropped: true,
      toolResults: 0,
      sameReading: true,
    },
  })
})

test('documents read for earlier messages give way before the first reading does, and the newest message keeps its own', async () => {
  const { engine, accepted, adjustments } = countingModel()
  const addition = (i: number) => `${NOTEBOOK_ADDITION}\n\n${`Source ${i} about Atlas. `.repeat(1100)}`.slice(0, 22_000)
  for (let i = 0; i < 10; i++) {
    engine.appendContextMessage(addition(i), [`/mock/Source-${i}.md`, `/mock/Source-${i}-b.md`])
    engine.appendUserMessage(`Question ${i}?`)
    engine.seedConversation([{ role: 'assistant', content: `Answer ${i}.` }])
  }
  engine.appendContextMessage(addition(10), ['/mock/Source-10.md'])
  engine.appendUserMessage('Question 10?')
  const notebook = 'A note from the first reading. '.repeat(3300).slice(0, 100_000)
  let fits = 0
  await engine.runTurn({
    instructions: ['Standing rule.', notebook],
    notebook: {
      instructions: notebook,
      tokens: notebook.length / 4,
      fit: (tokens) => {
        fits++
        return { instructions: notebook.slice(0, tokens * 4), tokens }
      },
    },
    tools: {},
    toolApproval: {},
  })

  const [request] = accepted as [string]
  const [adjustment] = adjustments()
  const whole = (i: number) => request.includes(JSON.stringify(addition(i)).slice(1, -1))
  assert({
    given: 'ten earlier messages that each brought documents, a newest one that did too, and a first reading',
    should:
      'turn the oldest of those documents into source references until a quarter of the room is free, and touch neither the first reading nor the newest message',
    actual: {
      firstReadingCuts: fits,
      firstReadingWhole: request.includes(notebook),
      oldestSetAside: !whole(0) && request.includes('/mock/Source-0.md'),
      newestWhole: whole(10),
      questionsKept: Array.from({ length: 11 }, (_, i) => `Question ${i}?`).every((question) =>
        request.includes(question),
      ),
      // Two documents came with each earlier message.
      notes:
        adjustment?.compacted?.notes === (adjustment?.compactedSources ?? 0) * 2 &&
        (adjustment?.compactedSources ?? 0) > 0,
      roomLeft: tokensOf(request) <= LIMIT * 0.8,
    },
    expected: {
      firstReadingCuts: 0,
      firstReadingWhole: true,
      oldestSetAside: true,
      newestWhole: true,
      questionsKept: true,
      notes: true,
      roomLeft: true,
    },
  })
})

test('one result too large for the room is shortened as it arrives, and no reading is dropped to hold it', async () => {
  const huge = `Export: ${'row of the Atlas export. '.repeat(17_000)}`.slice(0, 400_000)
  const { engine, accepted, adjustments } = countingModel((prompt) =>
    (prompt as Array<{ role: string }>).some((message) => message.role === 'tool')
      ? reply()
      : step([{ type: 'tool-call', toolCallId: 'export-one', toolName: 'export', input: '{}' }], 'tool-calls'),
  )
  const notebook = 'A note from the first reading. '.repeat(3300).slice(0, 100_000)
  let fits = 0
  engine.appendUserMessage('Export the Atlas table and tell me the total.')
  const result = await engine.runTurn({
    instructions: ['Standing rule.', notebook],
    notebook: {
      instructions: notebook,
      tokens: notebook.length / 4,
      fit: (tokens) => {
        fits++
        return { instructions: notebook.slice(0, tokens * 4), tokens }
      },
    },
    tools: {
      export: {
        inputSchema: jsonSchema<Record<string, never>>({ type: 'object', properties: {} }),
        execute: async () => huge,
      },
    },
    toolApproval: {},
  })

  const last = accepted.at(-1)!
  const adjustment = adjustments().at(-1)
  assert({
    given: 'a first reading that fits, then a single tool result twice the size of the whole request',
    should:
      'shorten that result to the room a compaction leaves, keep the reading whole, and call it a shortened result, not a compaction',
    actual: {
      reply: result.text,
      firstReadingCuts: fits,
      firstReadingWhole: last.includes(notebook),
      shortened: last.includes('Tool result shortened') && !last.includes(huge),
      fits: tokensOf(last) <= LIMIT,
      keptAQuarter: tokensOf(last) > LIMIT * 0.3,
      reported: [adjustment?.shortenedToolResults, adjustment?.compacted],
      historyKept: JSON.stringify(engine.snapshotMessages()).includes(huge),
    },
    expected: {
      reply: 'The sources agree.',
      firstReadingCuts: 0,
      firstReadingWhole: true,
      shortened: true,
      fits: true,
      keptAQuarter: true,
      reported: [1, undefined],
      historyKept: true,
    },
  })
})

test('the newest tool results outlast the first reading: twenty of them on a large model, fewer on a small one', async () => {
  const run = async (contextWindow: number, notebook: string) => {
    const accepted: string[] = []
    const events: ChatEngineEvent[] = []
    const engine = new ChatEngine({
      model: {
        model: new MockLanguageModelV3({
          doStream: async ({ prompt }) => {
            accepted.push(JSON.stringify(prompt))
            return reply()
          },
        }),
        contextWindow,
        maxOutputTokens: 200,
      },
      approvalHandler: async () => ({ approved: false, reason: '' }),
      onEvent: (event) => events.push(event),
    })
    engine.seedConversation([], [{ role: 'user', content: 'Look up the Atlas records.' }, ...lookups(30)])
    engine.appendUserMessage('What did they say?')
    let fits = 0
    await engine.runTurn({
      instructions: ['Standing rule.', notebook],
      notebook: {
        instructions: notebook,
        tokens: notebook.length / 4,
        fit: (tokens) => {
          fits++
          return { instructions: notebook.slice(0, tokens * 4), tokens }
        },
      },
      tools: {},
      toolApproval: {},
    })
    const [request] = accepted as [string]
    const whole = Array.from({ length: 30 }, (_, i) => request.includes(JSON.stringify(lookup(i)).slice(1, -1)))
    const adjustment = events.flatMap((event) => (event.type === 'context-adjusted' ? [event.adjustment] : [])).at(-1)
    return {
      firstReadingCuts: fits,
      cleared: adjustment?.compacted?.toolResults,
      oldestWhole: whole.indexOf(true),
      newestAllWhole: whole.slice(whole.indexOf(true)).every(Boolean),
    }
  }
  const note = 'A note from the first reading. '
  assert({
    given:
      'thirty results and a first reading that together overfill a model with a million tokens, and one with two hundred thousand',
    should:
      'clear every result older than the newest twenty on the large model and the newest seven on the small one, then cut the reading once for the rest',
    actual: [
      await run(1_000_000, note.repeat(50_000).slice(0, 1_520_000)),
      await run(200_000, note.repeat(13_000).slice(0, 400_000)),
    ],
    expected: [
      { firstReadingCuts: 1, cleared: 10, oldestWhole: 10, newestAllWhole: true },
      { firstReadingCuts: 1, cleared: 23, oldestWhole: 23, newestAllWhole: true },
    ],
  })
})

test('a first reading cut to nothing leaves no empty block in the request', async () => {
  const systems: string[][] = []
  const model = new MockLanguageModelV3({
    provider: 'anthropic.messages',
    doStream: async ({ prompt }) => {
      systems.push(prompt.flatMap((message) => (message.role === 'system' ? [message.content] : [])))
      if (systems.length === 1) throw new InputTokenLimitError(9000, 1000)
      return reply()
    },
  })
  const engine = new ChatEngine({
    model: { model, maxOutputTokens: 200 },
    approvalHandler: async () => ({ approved: false, reason: '' }),
  })
  const notebook = 'A note from the first reading. '.repeat(300)
  engine.appendUserMessage('Summarize the notes.')
  const result = await engine.runTurn({
    instructions: ['Standing rule.', notebook],
    notebook: { instructions: notebook, tokens: notebook.length / 4, fit: () => ({ instructions: '', tokens: 0 }) },
    tools: {},
    toolApproval: {},
  })
  assert({
    given: 'a request so far over its limit that the whole first reading has to go',
    should: 'send the standing instructions alone, with no empty block where the reading was',
    actual: [result.text, systems],
    expected: ['The sources agree.', [['Standing rule.', notebook.trim()], ['Standing rule.']]],
  })
})

test('a provider that counts its own requests is not treated as full by the two-characters estimate', async () => {
  const run = async (provider: string) => {
    const accepted: string[] = []
    const events: ChatEngineEvent[] = []
    const engine = new ChatEngine({
      model: {
        model: new MockLanguageModelV3({
          provider,
          doStream: async ({ prompt }) => {
            accepted.push(JSON.stringify(prompt))
            return reply()
          },
        }),
        contextWindow: 200_000,
        maxOutputTokens: 200,
      },
      approvalHandler: async () => ({ approved: false, reason: '' }),
      onEvent: (event) => events.push(event),
    })
    // Sixty results of 6,000 characters: about 90,000 tokens as a model reads them, 180,000 by the estimate.
    engine.seedConversation([], [{ role: 'user', content: 'Look up the Atlas records.' }, ...lookups(60)])
    engine.appendUserMessage('What did they say?')
    await engine.runTurn({ instructions: ['Standing rule.'], tools: {}, toolApproval: {} })
    const [request] = accepted as [string]
    return {
      compacted: events.some((event) => event.type === 'context-adjusted' && !!event.adjustment.compacted),
      resultsWhole: Array.from({ length: 60 }, (_, i) =>
        request.includes(JSON.stringify(lookup(i)).slice(1, -1)),
      ).filter(Boolean).length,
    }
  }
  assert({
    given: 'the same chat, half the size of its model’s window, on Gemini and on a host with no counter',
    should: 'send it whole on Gemini, whose own counter decides, and compact it on the host measured by estimate',
    actual: [await run('gemini'), (await run('cerebras.chat')).compacted],
    expected: [{ compacted: false, resultsWhole: 60 }, true],
  })
})
