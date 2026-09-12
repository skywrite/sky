import { createImageEvaluationFixture, imageEvaluationCases } from './fixtures.ts'
import { measureImageEvaluation } from './metrics.ts'
import type {
  ImageEvaluationAttempt,
  ImageEvaluationCaseResult,
  ImageEvaluationOptions,
  ImageEvaluationOutput,
  ImageEvaluationReport,
  ImageEvaluationUsage,
} from './types.ts'

function positive(value: number, name: string, integer = false): number {
  if (!Number.isFinite(value) || value <= 0 || (integer && !Number.isInteger(value)))
    throw new Error(`${name} must be a positive ${integer ? 'integer' : 'number'}.`)
  return value
}

function attemptScore(attempt: ImageEvaluationAttempt): number {
  const metrics = attempt.metrics
  if (!metrics?.dimensions.passed) return -1
  // A replacement can never outrank an otherwise comparable result by damaging protected pixels.
  const preservation = metrics.preservation?.passed && metrics.transparency?.passed ? 10 : 0
  const targets = metrics.targets.length
    ? metrics.targets.reduce((sum, target) => sum + target.intersectionOverUnion, 0) / metrics.targets.length
    : 0
  const transparent = metrics.transparentTargets.every((target) => target.passed) ? 1 : 0
  return (
    preservation +
    targets +
    transparent +
    (metrics.objectivePassed ? 2 : 0) +
    (attempt.review?.status === 'passed' ? 0.1 : 0)
  )
}

async function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  let handler: () => void = () => {}
  const aborted = new Promise<never>((_, reject) => {
    handler = () => reject(signal.reason)
    signal.addEventListener('abort', handler, { once: true })
  })
  try {
    return await Promise.race([operation, aborted])
  } finally {
    signal.removeEventListener('abort', handler)
  }
}

function usageTotals(attempts: ImageEvaluationAttempt[]): ImageEvaluationUsage {
  const result: ImageEvaluationUsage = {}
  for (const name of ['inputTokens', 'outputTokens', 'imageGenerations'] as const) {
    const values = attempts.map((attempt) => attempt.usage?.[name]).filter((value) => value !== undefined)
    if (values.length) result[name] = values.reduce((sum, value) => sum + value, 0)
  }
  return result
}

export async function runImageEvaluations(options: ImageEvaluationOptions): Promise<ImageEvaluationReport> {
  const ids = options.caseIds ?? imageEvaluationCases.map((item) => item.id)
  if (new Set(ids).size !== ids.length) throw new Error('Evaluation case IDs must be unique.')
  for (const id of ids)
    if (!imageEvaluationCases.some((item) => item.id === id)) throw new Error(`Unknown image evaluation case: ${id}`)
  const perCase = positive(options.maxAttemptsPerCase ?? 1, 'maxAttemptsPerCase', true)
  const totalLimit = positive(options.maxTotalAttempts ?? Math.max(1, ids.length * perCase), 'maxTotalAttempts', true)
  const durationLimit = positive(options.maxDurationMs ?? 900_000, 'maxDurationMs', true)
  if (perCase > 5) throw new Error('maxAttemptsPerCase cannot exceed 5; compare larger runs as separate evaluations.')
  if (options.maxCostUsd !== undefined) {
    positive(options.maxCostUsd, 'maxCostUsd')
    positive(options.estimatedAttemptCostUsd ?? 0, 'estimatedAttemptCostUsd')
  }
  options.signal?.throwIfAborted()
  const started = performance.now()
  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(durationLimit)])
    : AbortSignal.timeout(durationLimit)
  const cases: ImageEvaluationCaseResult[] = []
  const attempts: ImageEvaluationAttempt[] = []
  let reportedCost = 0
  let unknownCost = false
  for (const id of ids) {
    const definition = imageEvaluationCases.find((item) => item.id === id)!
    const result: ImageEvaluationCaseResult = {
      id,
      status: 'incomplete',
      visualRequirements: definition.visualRequirements,
      attempts: [],
      stopReason: 'attempt_limit',
    }
    cases.push(result)
    let fixture: Awaited<ReturnType<typeof createImageEvaluationFixture>> | undefined
    let bestScore = Number.NEGATIVE_INFINITY
    let stalled = 0
    for (let attempt = 1; attempt <= perCase; attempt++) {
      options.signal?.throwIfAborted()
      const remainingMs = Math.max(0, durationLimit - (performance.now() - started))
      if (signal.aborted || remainingMs <= 0) {
        result.stopReason = 'time_limit'
        break
      }
      if (attempts.length >= totalLimit) break
      if (options.maxCostUsd !== undefined && unknownCost) {
        result.stopReason = 'cost_unavailable'
        break
      }
      const remainingCost =
        options.maxCostUsd === undefined ? undefined : Math.max(0, options.maxCostUsd - reportedCost)
      if (remainingCost !== undefined && remainingCost < options.estimatedAttemptCostUsd!) {
        result.stopReason = 'cost_limit'
        break
      }
      fixture ??= await createImageEvaluationFixture(id)
      const attemptStarted = performance.now()
      const record: ImageEvaluationAttempt = { attempt, latencyMs: 0 }
      let output: ImageEvaluationOutput | undefined
      try {
        signal.throwIfAborted()
        output = await abortable(
          options.generate({
            fixture,
            attempt,
            previous: result.attempts.at(-1),
            signal,
            remaining: {
              durationMs: Math.max(0, durationLimit - (performance.now() - started)),
              attempts: totalLimit - attempts.length,
              costUsd: remainingCost,
            },
          }),
          signal,
        )
        record.review = output.review
        record.usage = output.usage
        record.artifacts = output.artifacts
        if (output.costUsd !== undefined && Number.isFinite(output.costUsd) && output.costUsd >= 0) {
          record.costUsd = output.costUsd
          reportedCost += output.costUsd
        } else {
          unknownCost = true
        }
        record.metrics = await measureImageEvaluation(fixture, output.data)
      } catch (error) {
        options.signal?.throwIfAborted()
        if (!output) unknownCost = true
        record.error = error instanceof Error ? error.message : String(error)
      }
      record.latencyMs = Math.round(performance.now() - attemptStarted)
      result.attempts.push(record)
      attempts.push(record)
      if (output && options.onAttempt) await options.onAttempt(fixture, output, record)
      if (signal.aborted) {
        result.stopReason = 'time_limit'
        break
      }
      const score = attemptScore(record)
      if (record.metrics && score > bestScore + 0.001) {
        bestScore = score
        result.bestAttempt = attempt
        stalled = 0
      } else {
        stalled++
      }
      if (record.metrics?.objectivePassed && record.review?.status !== 'needs_revision') {
        result.stopReason = 'passed'
        break
      }
      if (stalled >= 2) {
        result.stopReason = 'stalled'
        break
      }
    }
    result.status = result.attempts.some((attempt) => attempt.metrics?.objectivePassed)
      ? 'objective_pass'
      : result.attempts.some((attempt) => attempt.metrics)
        ? 'failed'
        : 'incomplete'
  }
  return {
    version: 1,
    scope: 'objective_metrics_with_separate_visual_review',
    cases,
    totals: {
      objectivePasses: cases.filter((item) => item.status === 'objective_pass').length,
      failures: cases.filter((item) => item.status === 'failed').length,
      incomplete: cases.filter((item) => item.status === 'incomplete').length,
      attempts: attempts.length,
      latencyMs: Math.round(performance.now() - started),
      reportedCostUsd: reportedCost,
      costComplete: !unknownCost,
      usage: usageTotals(attempts),
      usageComplete: attempts.every((attempt) => attempt.usage !== undefined),
    },
  }
}
