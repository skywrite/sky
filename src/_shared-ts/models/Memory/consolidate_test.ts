import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { CONSOLIDATE_POLICY, planConsolidation } from './consolidate.ts'
import type { MemoryEntry, MemoryKind } from './mod.ts'
import type { MemoryUsage } from './usage.ts'

const TODAY = new PlainDate('2026-06-01')

function entry(over: Partial<MemoryEntry> & { slug: string }): MemoryEntry {
  return {
    path: `/nb/ai/memory/${over.slug}.md`,
    kind: 'glossary' as MemoryKind,
    summary: `About ${over.slug}`,
    body: `Body of ${over.slug}.`,
    freshness: '2026-05-20',
    uses: 0,
    ...over,
  }
}

function plan(entries: MemoryEntry[], usage: Array<[string, MemoryUsage]> = [], usageAvailable = true) {
  return planConsolidation({ entries, usage: new Map(usage), usageAvailable, today: TODAY })
}

test('planConsolidation - threads expire by age, fresh ones stay', () => {
  const result = plan([
    entry({ slug: 'fresh-loop', kind: 'thread', freshness: '2026-05-25' }),
    entry({ slug: 'stale-loop', kind: 'thread', freshness: '2026-04-01' }),
  ])
  assert({
    given: 'a fresh and a stale thread',
    should: 'delete only the stale one',
    actual: result.ops,
    expected: [{ op: 'delete', slug: 'stale-loop', reason: 'expired thread (stale since 2026-04-01)' }],
  })
})

test('planConsolidation - observations promote at the confirmation bar or expire stale', () => {
  const result = plan([
    entry({ slug: 'confirmed-fact', kind: 'observation', uses: 3, summary: 'Jane lifts on weekdays' }),
    entry({ slug: 'stale-guess', kind: 'observation', uses: 1, freshness: '2026-04-01' }),
    entry({ slug: 'young-guess', kind: 'observation', uses: 0, freshness: '2026-05-28' }),
  ])
  assert({
    given: 'a well-confirmed, a stale unconfirmed, and a young observation',
    should: 'propose the confirmed one, expire the stale one, keep the young one',
    actual: result.ops,
    expected: [
      { op: 'propose', flow: 'notebook capture', gist: 'Jane lifts on weekdays' },
      { op: 'delete', slug: 'stale-guess', reason: 'stale observation, never promoted (since 2026-04-01)' },
    ],
  })
})

test('planConsolidation - durable kinds need stale AND unshipped AND telemetry', () => {
  const entries = [
    entry({ slug: 'old-unused', kind: 'lesson', freshness: '2025-10-01' }),
    entry({ slug: 'old-but-shipping', kind: 'glossary', freshness: '2025-10-01' }),
    entry({ slug: 'recent-unused', kind: 'preference', freshness: '2026-05-01' }),
  ]
  const withTelemetry = plan(entries, [['old-but-shipping', { ships: 4, lastShipped: '2026-05-30' }]])
  const withoutTelemetry = planConsolidation({
    entries,
    usage: new Map(),
    usageAvailable: false,
    today: TODAY,
  })
  assert({
    given: 'durable memories with and without ships, with and without telemetry',
    should: 'expire only the stale unshipped one, and nothing blind',
    actual: { withTelemetry: withTelemetry.ops, withoutTelemetry: withoutTelemetry.ops },
    expected: {
      withTelemetry: [{ op: 'delete', slug: 'old-unused', reason: 'stale and unshipped (since 2025-10-01)' }],
      withoutTelemetry: [],
    },
  })
})

test('planConsolidation - locked and undated memories are spared and noted', () => {
  const result = plan([
    entry({ slug: 'locked-thread', kind: 'thread', freshness: '2026-01-01', locked: true }),
    entry({ slug: 'undated-thread', kind: 'thread', freshness: undefined }),
    entry({ slug: 'mystery', kind: undefined }),
  ])
  assert({
    given: 'a locked stale thread, an undated thread, and an unknown kind',
    should: 'plan no ops and note the undated and unknown ones',
    actual: { ops: result.ops, notes: result.notes },
    expected: {
      ops: [],
      notes: ['undated-thread: no dates — expiry cannot age it', 'mystery: unknown kind — left alone'],
    },
  })
})

test('planConsolidation - budget pressure expires weakest first, never locked', () => {
  // Three ~7k-token bodies: together well over the 15k cap, and expiring
  // one weak entry brings the survivors back under it.
  const bigBody = 'memory '.repeat(4000)
  const entries = [
    entry({ slug: 'locked-big', body: bigBody, locked: true, uses: 0 }),
    entry({ slug: 'weak-big', body: bigBody, uses: 0 }),
    entry({ slug: 'strong-big', body: bigBody, uses: 5 }),
  ]
  const result = plan(entries, [['strong-big', { ships: 9 }]])
  assert({
    given: 'a store over budget with a locked, a weak, and a well-used memory',
    should: 'expire the weak one first and leave the locked one alone',
    actual: {
      deleted: result.ops.filter((o) => o.op === 'delete').map((o) => (o.op === 'delete' ? o.slug : '')),
      overBudget: result.storeTokens > CONSOLIDATE_POLICY.storeMaxTokens,
    },
    expected: { deleted: ['weak-big'], overBudget: true },
  })
})
