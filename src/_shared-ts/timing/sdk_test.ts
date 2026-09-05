import { APICallError, generateText, isStepCount, jsonSchema, streamText } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { assert, test } from '#test'
import { currentTimingSpan, TimingSpan, withTiming, withTimingEnvironment, type TimingEvent } from './mod.ts'
import { createTimingTelemetry } from './sdk.ts'
import { timingSummary } from './summary.ts'

const USAGE = {
  inputTokens: { total: 10, noCache: 4, cacheRead: 6, cacheWrite: 0 },
  outputTokens: { total: 2, text: 2, reasoning: 0 },
}

test('SDK tracing measures streamed bodies and nested tool/model execution without changing results', async () => {
  let now = 0
  const events: TimingEvent[] = []
  const telemetry = { integrations: [createTimingTelemetry()] }
  const nested = new MockLanguageModelV3({
    doGenerate: async () => {
      now += 7
      return {
        content: [{ type: 'text', text: 'found' }],
        finishReason: { unified: 'stop', raw: undefined },
        usage: USAGE,
        warnings: [],
      }
    },
  })
  let step = 0
  const model = new MockLanguageModelV3({
    doStream: async () => {
      now += 2 // headers alone are not the response time
      const parts: unknown[] =
        step++ === 0
          ? [{ type: 'tool-call', toolCallId: 'lookup-1', toolName: 'notebook_query', input: '{}' }]
          : [
              { type: 'text-start', id: 't' },
              { type: 'text-delta', id: 't', delta: 'done' },
              { type: 'text-end', id: 't' },
            ]
      parts.push({
        type: 'finish',
        finishReason: { unified: step === 1 ? 'tool-calls' : 'stop', raw: undefined },
        usage: USAGE,
      })
      return {
        stream: new ReadableStream({
          pull(controller) {
            const part = parts.shift()
            if (!part) {
              controller.close()
              return
            }
            now += 5
            controller.enqueue(part)
          },
        }) as never,
      }
    },
  })
  await withTimingEnvironment({ now: () => now, sink: (event) => events.push(event) }, async () => {
    const root = new TimingSpan({ kind: 'command', name: 'ai:research' })
    const result = await root.run(async () => {
      const stream = streamText({
        model,
        telemetry,
        prompt: 'Look up Atlas',
        stopWhen: isStepCount(3),
        tools: {
          notebook_query: {
            inputSchema: jsonSchema({ type: 'object', properties: {} }),
            execute: async () => {
              now += 10
              await withTiming({ kind: 'command', name: 'markdown:sel' }, async () => {
                now += 4
              })
              const answer = await generateText({ model: nested, telemetry, prompt: 'Summarize a mock document' })
              return { success: true, text: answer.text }
            },
          },
        },
      })
      return stream.text
    })
    root.finish()
    const ended = events.filter((e) => e.event === 'timing-end').map((e) => e.span)
    const tool = ended.find((r) => r.kind === 'tool')!
    const inner = ended.find((r) => r.kind === 'model' && r.parentSpanId === tool.spanId)
    const summary = timingSummary(root)
    assert({
      given: 'a streaming research loop with a nested model inside its query tool',
      should: 'time full streams, retain hierarchy and tokens, and return the same answer',
      actual: {
        result,
        calls: summary.calls,
        tools: summary.tools.notebook_query?.count,
        nestedModel: !!inner,
        nestedCommand: ended.some((r) => r.name === 'markdown:sel' && r.parentSpanId === tool.spanId),
        streamsLongerThanHeaders: ended
          .filter((r) => r.kind === 'model' && r !== inner)
          .every((r) => r.durationMs! > 2),
        tokens: inner?.usage,
        outcome: tool.outcome,
        after: currentTimingSpan() === undefined,
      },
      expected: {
        result: 'done',
        calls: 3,
        tools: 1,
        nestedModel: true,
        nestedCommand: true,
        streamsLongerThanHeaders: true,
        tokens: { input: 4, cacheRead: 6, cacheWrite: 0, output: 2 },
        outcome: 'success',
        after: true,
      },
    })
  })
})

test('SDK retry attempts and tool failures are retained', async () => {
  const events: TimingEvent[] = []
  let attempts = 0
  const model = new MockLanguageModelV3({
    doGenerate: async () => {
      if (++attempts === 1)
        throw new APICallError({
          message: 'retry',
          url: 'https://example.com/model',
          requestBodyValues: {},
          statusCode: 500,
          isRetryable: true,
        })
      return {
        content: [{ type: 'tool-call', toolCallId: 'bad-query', toolName: 'notebook_query', input: '{}' }],
        finishReason: { unified: 'tool-calls', raw: undefined },
        usage: USAGE,
        warnings: [],
      }
    },
  })
  await withTimingEnvironment({ now: () => performance.now(), sink: (event) => events.push(event) }, async () => {
    const root = new TimingSpan({ kind: 'command', name: 'ai:research' })
    await root.run(() =>
      generateText({
        model,
        prompt: 'mock',
        maxRetries: 1,
        telemetry: { integrations: [createTimingTelemetry()] },
        tools: {
          notebook_query: {
            inputSchema: jsonSchema({ type: 'object', properties: {} }),
            execute: async () => ({ valid: false, errors: ['unknown mock field'] }),
          },
        },
      }),
    )
    root.finish()
    const ended = events.filter((e) => e.event === 'timing-end').map((e) => e.span)
    assert({
      given: 'one retry followed by a query that returns validation errors',
      should: 'keep both model attempts and the unsuccessful tool outcome',
      actual: {
        attempts: ended.filter((r) => r.kind === 'model').map((r) => [r.attempt, r.outcome]),
        retries: timingSummary(root).retries,
        tool: ended.find((r) => r.kind === 'tool')?.outcome,
      },
      expected: {
        attempts: [
          [1, 'error'],
          [2, 'success'],
        ],
        retries: 1,
        tool: 'fail',
      },
    })
  })
})

test('a streamed model failure and cancellation close spans and preserve stream behavior', async () => {
  const events: TimingEvent[] = []
  const telemetry = createTimingTelemetry()
  const failure = new Error('synthetic stream failure')
  let cancelled = false
  let caught: unknown
  await withTimingEnvironment({ now: () => performance.now(), sink: (event) => events.push(event) }, async () => {
    const failed = await telemetry.executeLanguageModelCall!({
      callId: 'failure',
      execute: async () => ({
        stream: new ReadableStream({
          pull(controller) {
            controller.error(failure)
          },
        }),
      }),
    })
    try {
      await failed.stream.getReader().read()
    } catch (error) {
      caught = error
    }
    const unfinished = await telemetry.executeLanguageModelCall!({
      callId: 'cancelled',
      execute: async () => ({
        stream: new ReadableStream({
          cancel() {
            cancelled = true
          },
        }),
      }),
    })
    await unfinished.stream.cancel('stop')
  })
  assert({
    given: 'a provider stream that fails, and one its consumer cancels',
    should: 'keep the error identity, cancel the provider, and finish both spans once',
    actual: {
      sameError: caught === failure,
      cancelled,
      outcomes: events.filter((e) => e.event === 'timing-end').map((e) => e.span.outcome),
    },
    expected: { sameError: true, cancelled: true, outcomes: ['error', 'aborted'] },
  })
})
