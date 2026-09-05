import { assert, test } from '#test'
import { currentTimingSpan, TimingSpan, withTiming, withTimingEnvironment, type TimingEvent } from './mod.ts'
import { parseTimingLog } from './read.ts'
import { timingDetail, timingSummary } from './summary.ts'

function harness() {
  let now = 0
  const events: TimingEvent[] = []
  return {
    env: { now: () => now, sink: (event: TimingEvent) => events.push(event) },
    tick: (ms: number) => {
      now += ms
    },
    events,
  }
}

test('archived timing is stable and elapsed time survives a wall-clock adjustment', async () => {
  let now = 0
  let instant = '2026-01-27T15:31:00.125Z'
  await withTimingEnvironment({ now: () => now, instant: () => instant, sink: () => {} }, async () => {
    const root = new TimingSpan({ kind: 'turn', name: 'ai:chat' })
    const pending = root.run(() => new TimingSpan({ kind: 'model', name: 'mock-background' }))
    now = 1250.5
    instant = '2026-01-27T15:30:59.000Z'
    root.finish()
    const archived = timingDetail(root)
    now += 100
    pending.finish()
    assert({
      given: 'a clock that moves backward and background work finishing after the reply',
      should: 'keep the positive precise duration and leave the archived unfinished call unchanged',
      actual: {
        duration: archived.wallMs,
        started: archived.startedAt,
        finished: archived.finishedAt,
        incomplete: archived.incomplete,
        background: archived.spans.find((span) => span.spanId === pending.record.spanId)?.durationMs,
      },
      expected: {
        duration: 1250.5,
        started: '2026-01-27T15:31:00.125Z',
        finished: '2026-01-27T15:30:59.000Z',
        incomplete: true,
        background: undefined,
      },
    })
  })
})

test('nested agent model time is not charged to its enclosing tool', async () => {
  const h = harness()
  await withTimingEnvironment(h.env, async () => {
    const root = new TimingSpan({ kind: 'turn', name: 'ai:chat' })
    await root.run(() =>
      withTiming({ kind: 'tool', name: 'ai_research' }, async () => {
        h.tick(10)
        await withTiming({ kind: 'model', name: 'mock-model' }, async () => {
          h.tick(60)
        })
        await withTiming({ kind: 'tool', name: 'notebook_query' }, async () => {
          await withTiming({ kind: 'command', name: 'markdown:sel' }, async () => {
            h.tick(10)
          })
          h.tick(10)
        })
        h.tick(10)
      }),
    )
    h.tick(10)
    root.finish()
    const summary = timingSummary(root)
    assert({
      given: 'a research tool containing a model, query, and command',
      should: 'count active intervals once while retaining inclusive per-tool totals',
      actual: {
        wall: summary.wallMs,
        model: summary.modelMs,
        tools: summary.toolMs,
        other: summary.otherMs,
        overlap: summary.overlapMs,
        query: summary.tools.notebook_query?.ms,
        outer: summary.tools.ai_research?.ms,
      },
      expected: { wall: 110, model: 60, tools: 40, other: 10, overlap: 0, query: 20, outer: 100 },
    })
  })
})

test('parallel work retains its parents and reports overlapping wall time', async () => {
  const h = harness()
  await withTimingEnvironment(h.env, async () => {
    const root = new TimingSpan({ kind: 'turn', name: 'ai:chat' })
    const model = root.run(() => new TimingSpan({ kind: 'model', name: 'mock-model' }))
    h.tick(20)
    const tool = root.run(() => new TimingSpan({ kind: 'tool', name: 'notebook_read' }))
    const parents = await Promise.all([
      model.run(async () => {
        await Promise.resolve()
        return currentTimingSpan()?.record.spanId
      }),
      tool.run(async () => {
        await Promise.resolve()
        return currentTimingSpan()?.record.spanId
      }),
    ])
    h.tick(60)
    tool.finish()
    h.tick(20)
    model.finish()
    root.finish()
    const summary = timingSummary(root)
    assert({
      given: 'independent model and tool work that overlaps for 60 ms',
      should: 'preserve parallel scopes and expose overlap instead of inflating wall time',
      actual: {
        correctParents: parents[0] === model.record.spanId && parents[1] === tool.record.spanId,
        wall: summary.wallMs,
        model: summary.modelMs,
        tools: summary.toolMs,
        overlap: summary.overlapMs,
        other: summary.otherMs,
      },
      expected: { correctParents: true, wall: 100, model: 100, tools: 60, overlap: 60, other: 0 },
    })
  })
})

test('timing is transparent on failure and incomplete runs remain inspectable', async () => {
  const h = harness()
  const failure = new Error('synthetic failure')
  let caught: unknown
  let calls = 0
  await withTimingEnvironment(
    {
      now: h.env.now,
      sink: () => {
        throw new Error('unavailable sink')
      },
    },
    async () => {
      try {
        await withTiming({ kind: 'command', name: 'mock:fail' }, async () => {
          calls++
          throw failure
        })
      } catch (error) {
        caught = error
      }
    },
  )
  await withTimingEnvironment(h.env, async () => {
    const span = new TimingSpan({ kind: 'command', name: 'mock:interrupted' })
    const log = h.events.map((event) => JSON.stringify(event)).join('\n') + '\n{"event":'
    const records = parseTimingLog(log)
    assert({
      given: 'a broken timing sink and a log ending in a torn write',
      should: 'preserve the exact error, execute once, and retain unmatched starts',
      actual: {
        same: caught === failure,
        calls,
        records: records.length,
        unfinished: records[0]?.durationMs === undefined,
        incomplete: timingSummary(span).incomplete,
      },
      expected: { same: true, calls: 1, records: 1, unfinished: true, incomplete: false },
    })
    span.finish()
    span.finish('error')
    const finished = parseTimingLog(h.events.map((event) => JSON.stringify(event)).join('\n'))
    assert({
      given: 'a span finished twice',
      should: 'close once and let its end replace its start',
      actual: { count: finished.length, outcome: finished[0]?.outcome, events: h.events.length },
      expected: { count: 1, outcome: 'success', events: 2 },
    })
  })
})
