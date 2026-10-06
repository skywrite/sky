import { Buffer } from 'node:buffer'
import { createAnthropic } from '@ai-sdk/anthropic'
import { APICallError, jsonSchema, type ModelMessage, simulateReadableStream } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { ANTHROPIC_REQUEST_BYTES, withAnthropicTokenCount } from '#shared/ai/inputTokenLimit.ts'
import { assert, test } from '#test'
import ChatEngine from './mod.ts'
import { WorkingContext } from './workingContext.ts'

function claudeReply() {
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
    {
      type: 'content_block_delta',
      index: 0,
      delta: {
        type: 'text_delta',
        text: 'The newest file is readable. Atlas: total 42, page 2. Another file is still pending.',
      },
    },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 4 } },
    { type: 'message_stop' },
  ]
  return new Response(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

const native = (name: string, data: string) => ({
  type: 'content' as const,
  value: [
    { type: 'text' as const, text: `File: /mock/${name}\nSaved copy: /mock/Archive/${name}` },
    {
      type: 'file' as const,
      filename: name,
      mediaType: 'application/pdf',
      data: { type: 'data' as const, data },
      providerOptions: { sky: { attachmentPath: `/mock/Archive/${name}` } },
    },
  ],
})

test('the real Claude adapter recovers oversized saved history and a new batch before any HTTP request', async () => {
  const payload = Buffer.alloc(16 * 1024 * 1024, 1).toString('base64')
  const calls: Array<{ bytes: number; documents: number; deferred: boolean; findings: boolean }> = []
  const provider = createAnthropic({
    apiKey: 'test-key',
    fetch: withAnthropicTokenCount((async (url, init) => {
      const body = init!.body as string
      calls.push({
        bytes: Buffer.byteLength(body),
        documents: (body.match(/"type":"document"/g) ?? []).length,
        deferred: body.includes('This file still needs inspection'),
        findings: body.includes('Atlas: total 42, page 2.'),
      })
      return String(url).endsWith('/count_tokens') ? Response.json({ input_tokens: 100 }) : claudeReply()
    }) as typeof fetch),
  })
  const options = {
    model: { model: provider('claude-fable-5-1'), contextWindow: 10000, maxOutputTokens: 200 },
    approvalHandler: async () => ({ approved: false, reason: '' }),
  }
  const history: ModelMessage[] = [
    { role: 'user', content: 'Inspect these documents, preserving all original files.' },
    {
      role: 'assistant',
      content: [{ type: 'tool-call', toolCallId: 'a', toolName: 'read_file', input: { path: '/mock/Atlas.pdf' } }],
    },
    {
      role: 'tool',
      content: [{ type: 'tool-result', toolCallId: 'a', toolName: 'read_file', output: native('Atlas.pdf', payload) }],
    },
    {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Atlas: total 42, page 2.' },
        { type: 'tool-call', toolCallId: 'b', toolName: 'read_file', input: { path: '/mock/Second.pdf' } },
        { type: 'tool-call', toolCallId: 'c', toolName: 'read_file', input: { path: '/mock/Third.pdf' } },
      ],
    },
    {
      role: 'tool',
      content: [
        { type: 'tool-result', toolCallId: 'b', toolName: 'read_file', output: native('Second.pdf', payload) },
        { type: 'tool-result', toolCallId: 'c', toolName: 'read_file', output: native('Third.pdf', payload) },
      ],
    },
  ]
  const engine = new ChatEngine(options)
  history.push({
    role: 'assistant',
    content:
      '\n\n[The response failed: Request size exceeded. Completed tool results above remain valid; check them before retrying any action.]',
  })
  engine.seedConversation([], history)
  engine.appendUserMessage('Continue after the interrupted reply.')
  const tools = {
    read_file: {
      inputSchema: jsonSchema<{ path: string }>({ type: 'object', properties: { path: { type: 'string' } } }),
    },
  }
  await engine.runTurn({ instructions: ['Keep completed receipts.'], tools, toolApproval: {} })
  const original = engine.snapshotMessages()
  const restored = new ChatEngine(options)
  restored.seedConversation([], original)
  restored.workingContext = new WorkingContext(engine.workingContext.snapshot(original))
  restored.appendUserMessage('What is still pending?')
  await restored.runTurn({ instructions: ['Keep completed receipts.'], tools, toolApproval: {} })
  assert({
    given: 'a recovered chat with a previously read PDF and two fresh PDFs each within the individual file limit',
    should:
      'send only fitting bodies, retain pending inspection across restart, keep findings and preserve every original',
    actual: {
      requests: calls.length,
      allFit: calls.every((call) => call.bytes <= ANTHROPIC_REQUEST_BYTES),
      documents: calls.map((call) => call.documents),
      pending: calls.every((call) => call.deferred),
      findings: calls.every((call) => call.findings),
      originalFiles: original.filter((message) => message.role === 'tool').flatMap((message) => message.content).length,
      originalBytes: JSON.stringify(original).split(payload).length - 1,
    },
    expected: {
      requests: 4,
      allFit: true,
      documents: [1, 1, 0, 0],
      pending: true,
      findings: true,
      originalFiles: 3,
      originalBytes: 3,
    },
  })
})

test('a provider 413 retries the rejected model request without repeating a completed tool', async () => {
  let executions = 0
  let rejections = 0
  let generations = 0
  const model = new MockLanguageModelV3({
    provider: 'anthropic.messages',
    doStream: async ({ prompt }) => {
      const body = JSON.stringify(prompt)
      const hasResult = prompt.some((message) => message.role === 'tool')
      if (hasResult && !body.includes('contents deferred')) {
        rejections++
        throw new APICallError({
          url: 'https://example.com/messages',
          statusCode: 413,
          message: 'Request exceeds the maximum size',
          requestBodyValues: { messages: prompt },
        })
      }
      generations++
      return {
        stream: simulateReadableStream<any>({
          chunks: [
            { type: 'stream-start', warnings: [] },
            ...(hasResult
              ? [
                  { type: 'text-start', id: 't' },
                  {
                    type: 'text-delta',
                    id: 't',
                    delta: 'The completed receipt is intact; I can inspect the remaining file.',
                  },
                  { type: 'text-end', id: 't' },
                ]
              : [{ type: 'tool-call', toolCallId: 'one', toolName: 'collect', input: '{}' }]),
            {
              type: 'finish',
              finishReason: { unified: hasResult ? 'stop' : 'tool-calls', raw: undefined },
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
    model: { model, maxRetries: 0 },
    approvalHandler: async () => ({ approved: true, reason: '' }),
  })
  engine.appendUserMessage('Collect the files and inspect them.')
  const result = await engine.runTurn({
    instructions: [],
    toolApproval: {},
    tools: {
      collect: {
        inputSchema: jsonSchema<Record<string, never>>({ type: 'object', properties: {} }),
        execute: async () => {
          executions++
          return { receipt: 'synthetic-collection-receipt' }
        },
        toModelOutput: () => ({
          type: 'content' as const,
          value: [
            { type: 'text' as const, text: 'Receipt: synthetic-collection-receipt' },
            ...native('First.pdf', 'YWFh'.repeat(1000)).value,
            ...native('Second.pdf', 'YmJi'.repeat(1000)).value,
          ],
        }),
      },
    },
  })
  assert({
    given: 'a 413 from a compatible host after a tool has completed',
    should: 'retry only generation, retain the result, and finish with usable context',
    actual: [
      executions,
      rejections,
      generations,
      result.text.includes('receipt is intact'),
      JSON.stringify(engine.snapshotMessages()).includes('synthetic-collection-receipt'),
    ],
    expected: [1, 1, 2, true, true],
  })
})
