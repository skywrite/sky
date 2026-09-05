import { assert, test } from '#test'
import { type AIUsageRecord, currentUsageSource, runWithUsageSource, usageMeter } from './usageLog.ts'

const USAGE = {
  inputTokens: { total: 5600, noCache: 2, cacheRead: 3654, cacheWrite: 536 },
  outputTokens: { total: 46, text: 46, reasoning: 0 },
}

function meterFor(records: AIUsageRecord[]) {
  return usageMeter({ provider: 'anthropic', model: 'claude-opus-5' }, (r) => {
    records.push(r)
  })
}

test('usageMeter records a generation with the four counts, the model, and the running command', async () => {
  const records: AIUsageRecord[] = []
  const meter = meterFor(records)
  // deno-lint-ignore no-explicit-any
  const doGenerate = () => Promise.resolve({ usage: USAGE, content: [] } as any)
  const result = await runWithUsageSource('google:agent', () =>
    // deno-lint-ignore no-explicit-any
    meter.wrapGenerate!({ doGenerate, doStream: (() => {}) as any, params: {} as any, model: {} as any }),
  )
  assert({
    given: 'one generation made while a mission runs',
    should: 'hand the result back unchanged and record its counts under the mission',
    actual: { same: result.usage === USAGE, records: records.map(({ ts: _ts, ...r }) => r) },
    expected: {
      same: true,
      records: [
        {
          source: 'google:agent',
          provider: 'anthropic',
          model: 'claude-opus-5',
          input: 2,
          cacheRead: 3654,
          cacheWrite: 536,
          output: 46,
        },
      ],
    },
  })
})

test('usageMeter records a stream at its finish and lets every part through', async () => {
  const records: AIUsageRecord[] = []
  const meter = meterFor(records)
  const parts = [
    { type: 'stream-start', warnings: [] },
    { type: 'text-delta', id: 't', delta: 'ok' },
    { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage: USAGE },
  ]
  const doStream = () =>
    Promise.resolve({
      stream: new ReadableStream({
        start(controller) {
          for (const p of parts) controller.enqueue(p)
          controller.close()
        },
      }),
      // deno-lint-ignore no-explicit-any
    } as any)
  // deno-lint-ignore no-explicit-any
  const { stream } = await meter.wrapStream!({
    doStream,
    doGenerate: (() => {}) as any,
    params: {} as any,
    model: {} as any,
  })
  const seen: string[] = []
  for await (const part of stream as ReadableStream<{ type: string }>) seen.push(part.type)
  assert({
    given: 'a stream of three parts',
    should: 'pass all three on and record once, from the finish part',
    actual: { seen, count: records.length, output: records[0]?.output, source: records[0]?.source },
    expected: { seen: ['stream-start', 'text-delta', 'finish'], count: 1, output: 46, source: currentUsageSource() },
  })
})

test('the usage source is the innermost command, else the process kind', async () => {
  const outer = currentUsageSource()
  const nested = await runWithUsageSource('ai:chat', async () => {
    const inChat = currentUsageSource()
    const inTool = await runWithUsageSource('slack:unread', () => Promise.resolve(currentUsageSource()))
    return { inChat, inTool, after: currentUsageSource() }
  })
  assert({
    given: 'a tool command run inside a chat turn',
    should: 'name the tool inside, the chat around it, and the process kind outside both',
    actual: { ...nested, outer: ['cli', 'service'].includes(outer) },
    expected: { inChat: 'ai:chat', inTool: 'slack:unread', after: 'ai:chat', outer: true },
  })
})
