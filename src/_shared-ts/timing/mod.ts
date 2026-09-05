import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import type { TokenUsage } from '#universal/ai/tokenUsage.ts'
import { instantNow } from '#universal/dates/nbdt/mod.ts'

export type TimingKind = 'command' | 'turn' | 'generation' | 'model' | 'tool' | 'wait'
export type TimingOutcome = 'success' | 'fail' | 'error' | 'aborted' | 'incomplete'

/** Metadata only. Never put prompts, arguments, results, or error messages in a span. */
export interface TimingFields {
  kind: TimingKind
  name: string
  provider?: string
  model?: string
  callId?: string
  step?: number
  attempt?: number
}

export interface TimingRecord extends TimingFields {
  traceId: string
  spanId: string
  parentSpanId?: string
  /** Monotonic milliseconds from the trace's start, not an epoch timestamp. */
  startMs: number
  /** UTC instants with millisecond precision; absent on older log records. */
  startedAt?: string
  finishedAt?: string
  durationMs?: number
  outcome?: TimingOutcome
  firstOutputMs?: number
  usage?: TokenUsage
}

export interface TimingEvent {
  event: 'timing-start' | 'timing-end'
  span: TimingRecord
}

type Sink = (event: TimingEvent) => void
interface Environment {
  now: () => number
  /** Independent wall clock: duration math always uses the monotonic clock above. */
  instant?: () => string
  sink: Sink
}
interface Trace {
  id: string
  origin: number
  records: TimingRecord[]
  dropped: number
  env: Environment
}
const scope = new AsyncLocalStorage<TimingSpan>()
const environment = new AsyncLocalStorage<Environment>()
let defaultSink: Sink = () => {}
const MAX_TRACE_SPANS = 10_000

/** Hosts choose persistence; tests and consumers that never configure it write nothing. */
export function setTimingSink(sink: Sink): void {
  defaultSink = sink
}

/** An isolated clock and sink, also inherited by parallel children. */
export function withTimingEnvironment<T>(env: Environment, body: () => T): T {
  return environment.run(env, body)
}

export function currentTimingSpan(): TimingSpan | undefined {
  return scope.getStore()
}

export function timingOutcome(result: unknown): TimingOutcome {
  if (!result || typeof result !== 'object') return 'success'
  const value = result as { status?: string; success?: boolean; valid?: boolean; error?: unknown }
  if (value.status === 'error') return 'error'
  if (value.status === 'fail' || value.success === false || value.valid === false) return 'fail'
  if (value.error) return 'error'
  return 'success'
}

export function thrownOutcome(error: unknown): TimingOutcome {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError') ? 'aborted' : 'error'
}

export class TimingSpan {
  readonly record: TimingRecord
  private readonly trace: Trace
  private readonly began: number
  private closed = false

  constructor(fields: TimingFields, parent = currentTimingSpan(), newTrace = false) {
    const env = environment.getStore() ?? { now: () => performance.now(), sink: defaultSink }
    // A detached continuation after its parent finishes gets a new trace.
    const ancestor = !newTrace && parent && !parent.closed ? parent : undefined
    this.trace = ancestor?.trace ?? { id: randomUUID(), origin: env.now(), records: [], dropped: 0, env }
    this.began = this.trace.env.now()
    this.record = {
      ...fields,
      traceId: this.trace.id,
      spanId: randomUUID(),
      ...(ancestor ? { parentSpanId: ancestor.record.spanId } : {}),
      startMs: this.began - this.trace.origin,
      startedAt: (this.trace.env.instant ?? instantNow)(),
    }
    if (this.trace.records.length < MAX_TRACE_SPANS) this.trace.records.push(this.record)
    else this.trace.dropped++
    this.emit('timing-start')
  }

  run<T>(body: () => T): T {
    return scope.run(this, body)
  }

  firstOutput(): void {
    this.record.firstOutputMs ??= Math.max(0, this.trace.env.now() - this.began)
  }

  finish(outcome: TimingOutcome = 'success', usage?: TokenUsage): void {
    if (this.closed) return
    this.closed = true
    this.record.durationMs = Math.max(0, this.trace.env.now() - this.began)
    this.record.finishedAt = (this.trace.env.instant ?? instantNow)()
    this.record.outcome = outcome
    if (usage) this.record.usage = usage
    this.emit('timing-end')
  }

  snapshot(): { span: TimingRecord; records: TimingRecord[]; dropped: number } {
    const selected = new Set([this.record.spanId])
    const records: TimingRecord[] = []
    for (const record of this.trace.records) {
      if (record.spanId !== this.record.spanId && !selected.has(record.parentSpanId ?? '')) continue
      selected.add(record.spanId)
      records.push({ ...record })
    }
    const span = {
      ...this.record,
      durationMs: this.record.durationMs ?? Math.max(0, this.trace.env.now() - this.began),
    }
    return { span, records, dropped: this.trace.dropped }
  }

  private emit(event: TimingEvent['event']): void {
    try {
      this.trace.env.sink({ event, span: { ...this.record } })
    } catch {
      /* Timing never changes execution. */
    }
  }
}

/** Execute exactly once and preserve the original return value or thrown error. */
export async function withTiming<T>(fields: TimingFields, body: () => PromiseLike<T>, newTrace = false): Promise<T> {
  const span = new TimingSpan(fields, currentTimingSpan(), newTrace)
  try {
    const result = await span.run(body)
    span.finish(timingOutcome(result))
    return result
  } catch (error) {
    span.finish(thrownOutcome(error))
    throw error
  }
}
