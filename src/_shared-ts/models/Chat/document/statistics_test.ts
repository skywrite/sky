import type { TimingDetail } from '#shared/timing/summary.ts'
import { assert, test } from '#test'
import { NO_USAGE } from '#universal/ai/tokenUsage.ts'
import { serializeContextLog, splitContextLog, type ContextTurnLog } from './ContextLog/mod.ts'
import { chatStatistics } from './statistics.ts'

test('thread statistics retain nested agent usage once and round-trip with continuation data', () => {
  const mainUsage = { input: 100, cacheRead: 200, cacheWrite: 50, output: 25 }
  const agentUsage = { input: 40, cacheRead: 10, cacheWrite: 0, output: 15 }
  const timing: TimingDetail = {
    traceId: 'mock-trace',
    spanId: 'mock-turn',
    wallMs: 4000,
    modelMs: 2500,
    toolMs: 1000,
    overlapMs: 0,
    otherMs: 500,
    calls: 3,
    retries: 0,
    models: {
      'test/main': { count: 2, ms: 1500, usage: mainUsage },
      'test/writer': { count: 1, ms: 1000, usage: agentUsage },
    },
    tools: { writing_agent: { count: 1, ms: 2000 }, create_document: { count: 1, ms: 1000 } },
    incomplete: false,
    spans: [],
    droppedSpans: 0,
  }
  const entries: ContextTurnLog[] = [
    { turn: 4, queries: [], usage: mainUsage, timing, tools: [{ tool: 'writing_agent', outcome: 'ok' }] },
    { turn: 5, queries: [], model: 'test/legacy', usage: { ...NO_USAGE, input: 10, output: 5 } },
  ]
  const statistics = chatStatistics(entries, 4)
  const serialized = serializeContextLog(entries, {
    statistics,
    session: {
      version: 1,
      modelMessages: [{ role: 'assistant', content: 'Draft containing --> inside the text.' }],
    },
  })
  const restored = splitContextLog(`# Mock response\n${serialized}`)
  assert({
    given: 'a response thread whose specialist makes its own model and document calls',
    should: 'count the recorded work without doubling the main usage and preserve valid JSON comment boundaries',
    actual: {
      replies: restored.details?.statistics?.replies,
      usage: restored.details?.statistics?.usage,
      wallMs: restored.details?.statistics?.wallMs,
      tools: restored.details?.statistics?.tools,
      calls: restored.details?.statistics?.models['test/main']?.calls,
      history: restored.details?.session?.modelMessages?.[0]?.content,
      commentEnds: serialized.match(/-->/g)?.length,
    },
    expected: {
      replies: 2,
      usage: { input: 150, cacheRead: 210, cacheWrite: 50, output: 45 },
      wallMs: 4000,
      tools: { writing_agent: { calls: 1, ms: 2000 }, create_document: { calls: 1, ms: 1000 } },
      calls: 2,
      history: 'Draft containing --> inside the text.',
      commentEnds: 1,
    },
  })
})
