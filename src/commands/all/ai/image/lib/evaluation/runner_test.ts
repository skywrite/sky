import { assert, test } from '#test'
import { runImageEvaluations } from './runner.ts'

test('Evaluation retains attempts and callback evidence with metrics, latency, usage and cost', async () => {
  const observed: { priorFailed: boolean; budget: number; aborted: boolean }[] = []
  const saved: number[] = []
  const report = await runImageEvaluations({
    caseIds: ['expanded-star'],
    maxAttemptsPerCase: 5,
    generate: async ({ fixture, attempt, previous, signal, remaining }) => {
      observed.push({
        priorFailed: previous?.metrics?.objectivePassed === false,
        budget: remaining.attempts,
        aborted: signal.aborted,
      })
      return {
        data: attempt === 1 ? fixture.source : fixture.example,
        review: { status: 'passed', reason: 'A mock visual judgment, separate from measured checks.' },
        usage: { inputTokens: 100, outputTokens: 200, imageGenerations: 1 },
        costUsd: 0.25,
        artifacts: { result: `example-${attempt}.png` },
      }
    },
    onAttempt: async (_fixture, _output, attempt) => {
      saved.push(attempt.attempt)
    },
  })
  assert({
    given: 'a model review incorrectly approves a no-op before the second output satisfies the checks',
    should: 'retain both attempts, stop on measured success, and report the actual accounting',
    actual: {
      observed,
      saved,
      status: report.cases[0].status,
      stop: report.cases[0].stopReason,
      best: report.cases[0].bestAttempt,
      attempts: report.totals.attempts,
      cost: report.totals.reportedCostUsd,
      usage: report.totals.usage,
      costComplete: report.totals.costComplete,
      latencyMeasured: report.totals.latencyMs > 0,
      scope: report.scope,
    },
    expected: {
      observed: [
        { priorFailed: false, budget: 5, aborted: false },
        { priorFailed: true, budget: 4, aborted: false },
      ],
      saved: [1, 2],
      status: 'objective_pass',
      stop: 'passed',
      best: 2,
      attempts: 2,
      cost: 0.5,
      usage: { inputTokens: 200, outputTokens: 400, imageGenerations: 2 },
      costComplete: true,
      latencyMeasured: true,
      scope: 'objective_metrics_with_separate_visual_review',
    },
  })
})

test('A stalled evaluation keeps its best earlier candidate and does not call an objective pass a visual pass', async () => {
  const report = await runImageEvaluations({
    caseIds: ['expanded-star'],
    maxAttemptsPerCase: 5,
    generate: async ({ fixture, attempt }) => ({
      data: attempt === 1 ? fixture.example : fixture.source,
      review: { status: 'needs_revision', reason: 'The visual evaluator still found a defect.' },
    }),
  })
  assert({
    given: 'one geometrically correct output flagged by review, then two inferior outputs',
    should: 'retain the first candidate, stop stalled attempts and leave the visual concern visible',
    actual: [
      report.cases[0].bestAttempt,
      report.cases[0].stopReason,
      report.cases[0].attempts.length,
      report.cases[0].status,
      report.cases[0].attempts[0].review?.status,
      report.totals.costComplete,
      report.totals.usageComplete,
    ],
    expected: [1, 'stalled', 3, 'objective_pass', 'needs_revision', false, false],
  })
})

test('Attempt and cost limits prevent further callbacks across case boundaries', async () => {
  const cost = await runImageEvaluations({
    caseIds: ['expanded-star', 'diagram-label'],
    maxAttemptsPerCase: 5,
    maxCostUsd: 0.6,
    estimatedAttemptCostUsd: 0.3,
    generate: async ({ fixture }) => ({ data: fixture.source, costUsd: 0.35 }),
  })
  const count = await runImageEvaluations({
    caseIds: ['expanded-star', 'diagram-label'],
    maxTotalAttempts: 1,
    generate: async ({ fixture }) => ({ data: fixture.example }),
  })
  assert({
    given: 'a budget too small for another estimated attempt, and a separate one-attempt run',
    should: 'leave remaining cases incomplete without spending another request',
    actual: [
      cost.totals.attempts,
      cost.cases.map((item) => item.stopReason),
      cost.cases[1].status,
      count.totals.attempts,
      count.cases[1].status,
    ],
    expected: [1, ['cost_limit', 'cost_limit'], 'incomplete', 1, 'incomplete'],
  })
})

test('Unknown cost stops a cost-limited run instead of treating unreported spending as free', async () => {
  const report = await runImageEvaluations({
    caseIds: ['expanded-star'],
    maxAttemptsPerCase: 5,
    maxCostUsd: 1,
    estimatedAttemptCostUsd: 0.3,
    generate: async ({ fixture }) => ({ data: fixture.source }),
  })
  assert({
    given: 'an image callback that omits billing information',
    should: 'stop additional cost-limited attempts and report incomplete accounting',
    actual: [report.totals.attempts, report.cases[0].stopReason, report.totals.costComplete],
    expected: [1, 'cost_unavailable', false],
  })
})

test('Invalid case selections and budgets fail before generating images', async () => {
  let calls = 0
  const failures: boolean[] = []
  for (const options of [
    { caseIds: ['unknown'] },
    { caseIds: ['expanded-star', 'expanded-star'] },
    { maxAttemptsPerCase: 6 },
    { maxDurationMs: -1 },
    { maxCostUsd: 1 },
  ]) {
    try {
      await runImageEvaluations({
        ...options,
        generate: async ({ fixture }) => {
          calls++
          return { data: fixture.example }
        },
      })
    } catch (error) {
      failures.push(error instanceof Error)
    }
  }
  assert({
    given: 'invalid inputs or an unreservable cost ceiling',
    should: 'reject all before any callback',
    actual: [failures.length, calls],
    expected: [5, 0],
  })
})

test('Caller cancellation propagates without silently becoming a failed image case', async () => {
  const controller = new AbortController()
  controller.abort(new Error('Cancelled synthetic evaluation'))
  let calls = 0
  let message = ''
  try {
    await runImageEvaluations({
      caseIds: ['expanded-star'],
      signal: controller.signal,
      generate: async ({ fixture }) => {
        calls++
        return { data: fixture.example }
      },
    })
  } catch (error) {
    message = (error as Error).message
  }
  assert({
    given: 'a cancelled evaluation',
    should: 'propagate cancellation before creating a paid request',
    actual: [calls, message],
    expected: [0, 'Cancelled synthetic evaluation'],
  })
})

test('A time limit can finish a run even if a callback neglects to observe cancellation', async () => {
  const report = await runImageEvaluations({
    caseIds: ['expanded-star'],
    maxDurationMs: 250,
    generate: async () => new Promise(() => {}),
  })
  assert({
    given: 'a nonresponsive injected callback',
    should: 'report an incomplete timed-out case instead of hanging',
    actual: [report.cases[0].stopReason, report.cases[0].status, report.totals.latencyMs < 2000],
    expected: ['time_limit', 'incomplete', true],
  })
})
