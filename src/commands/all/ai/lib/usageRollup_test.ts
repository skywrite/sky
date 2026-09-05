import type { AIUsageRecord } from '#shared/ai/usageLog.ts'
import { assert, test } from '#test'
import { cachedShare, parseUsageLog, recordsSince, renderTable, rollup } from './usageRollup.ts'

const rec = (over: Partial<AIUsageRecord>): AIUsageRecord => ({
  ts: '2026-09-05 10:00 America/Chicago',
  source: 'ai:chat',
  provider: 'anthropic',
  model: 'claude-opus-5',
  input: 100,
  cacheRead: 0,
  cacheWrite: 0,
  output: 10,
  ...over,
})

test('rollup sums by model and by command, largest readers first', () => {
  const records = [
    rec({ source: 'ai:chat', input: 4000, cacheRead: 298_000, cacheWrite: 10_000, output: 4000 }),
    rec({ source: 'google:agent', input: 2, cacheRead: 3654, cacheWrite: 536, output: 46 }),
    rec({ source: 'google:agent', model: 'claude-haiku-4-5', input: 900, output: 12 }),
  ]
  const byModel = rollup(records, 'model')
  const bySource = rollup(records, 'source')
  assert({
    given: 'three calls over two models and two commands',
    should: 'sum each key with its call count, biggest reader first',
    actual: {
      models: byModel.map((r) => [r.name, r.calls, r.input, r.cacheRead, r.cacheWrite, r.output]),
      sources: bySource.map((r) => [r.name, r.calls]),
      share: byModel.map(cachedShare),
    },
    expected: {
      models: [
        ['claude-opus-5', 2, 4002, 301_654, 10_536, 4046],
        ['claude-haiku-4-5', 1, 900, 0, 0, 12],
      ],
      sources: [
        ['ai:chat', 1],
        ['google:agent', 2],
      ],
      share: [95, 0],
    },
  })
})

test('recordsSince keeps the days from the start day on', () => {
  const records = [
    rec({ ts: '2026-09-03 23:59 America/Chicago' }),
    rec({ ts: '2026-09-04 00:01 America/Chicago' }),
    rec({ ts: '2026-09-05 09:00 America/Chicago' }),
  ]
  assert({
    given: 'records over three days and a start of the second',
    should: 'keep the second and third',
    actual: recordsSince(records, '2026-09-04').map((r) => r.ts.slice(0, 10)),
    expected: ['2026-09-04', '2026-09-05'],
  })
})

test('parseUsageLog skips what is not a record and fills counts a line leaves out', () => {
  const text = [
    JSON.stringify(rec({})),
    'not json',
    JSON.stringify({
      ts: '2026-09-05 10:01 America/Chicago',
      source: 'summary:day',
      model: 'claude-fable-5',
      output: 7,
    }),
    '',
  ].join('\n')
  assert({
    given: 'a log with a bad line and a sparse one',
    should: 'return the two records, the sparse one with zeros',
    actual: parseUsageLog(text).map((r) => [r.source, r.input, r.output]),
    expected: [
      ['ai:chat', 100, 10],
      ['summary:day', 0, 7],
    ],
  })
})

test('renderTable lines up a header and the rows', () => {
  const lines = renderTable('model', rollup([rec({ input: 312_000, output: 4120 })], 'model'))
  assert({
    given: 'one row',
    should: 'print the header and the row with thousands and a cache share',
    actual: lines.map((l) => l.replace(/\s+/g, ' ').trim()),
    expected: ['model calls input cached written out cache%', 'claude-opus-5 1 312k 0 0 4.1k 0%'],
  })
})
