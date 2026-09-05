import { addUsage, NO_USAGE, type TokenUsage } from '#universal/ai/tokenUsage.ts'
import type { TimingOutcome, TimingRecord, TimingSpan } from './mod.ts'

export interface TimingTotal {
  count: number
  ms: number
}
export interface TimingSummary {
  traceId: string
  spanId: string
  wallMs: number
  startedAt?: string
  finishedAt?: string
  outcome?: TimingOutcome
  /** Union of model request intervals, including streamed responses. */
  modelMs: number
  /** Union of tool execution intervals, excluding their own nested model requests. */
  toolMs: number
  /** Model requests and independent tools can run simultaneously. */
  overlapMs: number
  otherMs: number
  calls: number
  retries: number
  tools: Record<string, TimingTotal>
  models: Record<string, TimingTotal & { usage: TokenUsage }>
  incomplete: boolean
}

/** Self-contained per-turn history. Repeated calls stay separate, including nested agents. */
export interface TimingDetail extends TimingSummary {
  spans: TimingRecord[]
  droppedSpans: number
}

type Interval = [number, number]
function merged(intervals: Interval[]): Interval[] {
  const out: Interval[] = []
  for (const [start, end] of intervals.filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0])) {
    const last = out.at(-1)
    if (last && start <= last[1]) last[1] = Math.max(last[1], end)
    else out.push([start, end])
  }
  return out
}
const length = (intervals: Interval[]) => merged(intervals).reduce((sum, [a, b]) => sum + b - a, 0)

function subtract(interval: Interval, holes: Interval[]): Interval[] {
  const result: Interval[] = []
  let at = interval[0]
  for (const [start, end] of merged(holes)) {
    if (end <= at || start >= interval[1]) continue
    if (start > at) result.push([at, start])
    at = Math.min(interval[1], Math.max(at, end))
  }
  if (at < interval[1]) result.push([at, interval[1]])
  return result
}

export function summarizeTiming(root: TimingRecord, all: TimingRecord[], dropped = 0): TimingSummary {
  const byId = new Map(all.map((r) => [r.spanId, r]))
  const beneath = (record: TimingRecord, ancestor: string): boolean => {
    const seen = new Set<string>()
    let parent = record.parentSpanId
    while (parent && !seen.has(parent)) {
      if (parent === ancestor) return true
      seen.add(parent)
      parent = byId.get(parent)?.parentSpanId
    }
    return false
  }
  const records = all.filter((r) => r.spanId === root.spanId || beneath(r, root.spanId))
  const end = root.startMs + (root.durationMs ?? 0)
  const interval = (r: TimingRecord): Interval => [
    Math.max(root.startMs, r.startMs),
    Math.min(end, r.startMs + (r.durationMs ?? Math.max(0, end - r.startMs))),
  ]
  const models = records.filter((r) => r.kind === 'model')
  const tools = records.filter((r) => r.kind === 'tool')
  const modelIntervals = models.map(interval)
  const toolIntervals = tools.flatMap((tool) =>
    subtract(interval(tool), models.filter((model) => beneath(model, tool.spanId)).map(interval)),
  )
  const modelMs = length(modelIntervals)
  const toolMs = length(toolIntervals)
  const busyMs = length([...modelIntervals, ...toolIntervals])
  const totals: TimingSummary = {
    traceId: root.traceId,
    spanId: root.spanId,
    wallMs: root.durationMs ?? 0,
    startedAt: root.startedAt,
    finishedAt: root.finishedAt,
    outcome: root.outcome,
    modelMs,
    toolMs,
    overlapMs: Math.max(0, modelMs + toolMs - busyMs),
    otherMs: Math.max(0, (root.durationMs ?? 0) - busyMs),
    calls: models.length,
    retries: models.filter((r) => (r.attempt ?? 1) > 1).length,
    tools: {},
    models: {},
    incomplete:
      dropped > 0 ||
      root.durationMs === undefined ||
      records.some((r) => (r.spanId !== root.spanId && r.durationMs === undefined) || r.outcome === 'incomplete'),
  }
  for (const r of tools) {
    const entry = (totals.tools[r.name] ??= { count: 0, ms: 0 })
    entry.count++
    entry.ms += r.durationMs ?? 0
  }
  for (const r of models) {
    const entry = (totals.models[`${r.provider ?? ''}/${r.model ?? r.name}`] ??= {
      count: 0,
      ms: 0,
      usage: { ...NO_USAGE },
    })
    entry.count++
    entry.ms += r.durationMs ?? 0
    if (r.usage) entry.usage = addUsage(entry.usage, r.usage)
  }
  totals.tools = Object.fromEntries(Object.entries(totals.tools).sort(([, a], [, b]) => b.ms - a.ms))
  return totals
}

export function timingSummary(span: TimingSpan): TimingSummary {
  const snapshot = span.snapshot()
  return summarizeTiming(snapshot.span, snapshot.records, snapshot.dropped)
}

/** Freeze a copy: background completions must not rewrite an archived turn. */
export function timingDetail(span: TimingSpan): TimingDetail {
  const snapshot = span.snapshot()
  return {
    ...summarizeTiming(snapshot.span, snapshot.records, snapshot.dropped),
    spans: structuredClone(snapshot.records),
    droppedSpans: snapshot.dropped,
  }
}

export function formatDuration(ms: number): string {
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`
  const seconds = Math.round(ms / 1000)
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s`
}

export function timingLine(t: TimingSummary): string {
  return `${formatDuration(t.wallMs)} total · model ${formatDuration(t.modelMs)} · tools ${formatDuration(t.toolMs)}${t.overlapMs > 0 ? ` · overlapping ${formatDuration(t.overlapMs)}` : ''} · other ${formatDuration(t.otherMs)}${t.incomplete ? ' · incomplete' : ''}`
}
