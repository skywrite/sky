import { assert, test } from '#test'
import { runImageAttempts } from './attempts.ts'
import type { ReviewedImage } from './attempts.ts'
import type { ImageReviewSummary } from './finish.ts'
import { passedReview } from './imageEditTestHelpers.ts'
import type { ImageEditAssessment } from './review.ts'

interface Candidate extends ReviewedImage {
  id: number
}

function candidate(
  id: number,
  changes: Partial<ImageEditAssessment> = {},
  status?: ImageReviewSummary['status'],
): Candidate {
  const assessment: ImageEditAssessment = {
    ...passedReview,
    score: 40,
    comparison: 'first',
    verdict: 'needs_revision',
    correction: `Correct the placement from attempt ${id}.`,
    checks: [{ requirement: 'Center the icon.', passed: false, detail: `Attempt ${id} is too far left.` }],
    ...changes,
  }
  return {
    id,
    data: new Uint8Array([id, 16, 32, 255]),
    review: {
      status: status ?? (assessment.verdict === 'pass' ? 'passed' : 'needs_revision'),
      reason: assessment.reason,
      maskAdjusted: false,
      assessments: status === 'unavailable' ? [] : [assessment],
    },
  }
}

test('Adaptive attempts can make four corrections and stop at the five-attempt cap', async () => {
  const requests: Array<{ attempt: number; previous?: number; feedback?: string }> = []
  const result = await runImageAttempts<Candidate>({
    maxAttempts: 5,
    budgetMs: 1000,
    generate: async ({ attempt, previous, feedback }) => {
      requests.push({ attempt, previous: previous?.id, feedback })
      return candidate(attempt, { comparison: attempt === 1 ? 'first' : 'better', score: 40 + attempt * 10 })
    },
  })
  assert({
    given: 'five progressively better candidates that still need work',
    should:
      'allow more than one correction, forward specific feedback and retain every version without exceeding the cap',
    actual: [
      requests.map((request) => request.attempt),
      requests.map((request) => request.previous),
      requests[0]!.feedback,
      requests[1]!.feedback?.includes('previous candidate is the retained best'),
      requests[1]!.feedback?.includes('Correct the placement from attempt 1.\nAttempt 1 is too far left.'),
      result.versions.map((version) => version.id),
      result.best.id,
      result.summary.used,
      result.summary.selected,
      result.summary.stopped,
    ],
    expected: [
      [1, 2, 3, 4, 5],
      [undefined, 1, 2, 3, 4],
      undefined,
      true,
      true,
      [1, 2, 3, 4, 5],
      5,
      5,
      5,
      'attempt_limit',
    ],
  })
})

test('A passing candidate stops retries as soon as all checks pass', async () => {
  const result = await runImageAttempts<Candidate>({
    maxAttempts: 5,
    budgetMs: 1000,
    generate: async ({ attempt }) =>
      candidate(
        attempt,
        attempt === 3 ? { ...passedReview, comparison: 'better' } : { comparison: attempt === 1 ? 'first' : 'better' },
      ),
  })
  assert({
    given: 'two corrective attempts followed by a passing third result',
    should: 'stop without spending the remaining budget',
    actual: [result.versions.map((version) => version.id), result.best.id, result.summary.used, result.summary.stopped],
    expected: [[1, 2, 3], 3, 3, 'passed'],
  })
})

test('Pairwise same and worse results retain the best and stop after two consecutive stalls', async () => {
  const previousIds: Array<number | undefined> = []
  const feedback: Array<string | undefined> = []
  const result = await runImageAttempts<Candidate>({
    maxAttempts: 5,
    budgetMs: 1000,
    generate: async ({ attempt, previous, feedback: instructions }) => {
      previousIds.push(previous?.id)
      feedback.push(instructions)
      return candidate(attempt, {
        comparison: attempt === 1 ? 'first' : attempt === 2 ? 'same' : 'worse',
        score: 40 + attempt * 10,
      })
    },
  })
  assert({
    given: 'a reviewer assigns higher absolute scores but finds no pairwise improvement',
    should: 'keep the first candidate and use its feedback while retaining rejected versions',
    actual: [
      previousIds,
      feedback[1]?.includes('Latest rejected attempt'),
      feedback[2]?.includes('Correct the placement from attempt 1.'),
      feedback[2]?.includes('Latest rejected attempt (same; notes only, not the previous best candidate)'),
      feedback[2]?.includes('Attempt 2 is too far left.'),
      result.versions.map((version) => version.id),
      result.best.id,
      result.summary.selected,
      result.summary.used,
      result.summary.stopped,
    ],
    expected: [[undefined, 1, 1], false, true, true, true, [1, 2, 3], 1, 1, 3, 'stalled'],
  })
})

test('An improvement resets the stall count before another correction', async () => {
  const comparisons: ImageEditAssessment['comparison'][] = ['first', 'same', 'better', 'same', 'better']
  const result = await runImageAttempts<Candidate>({
    maxAttempts: 5,
    budgetMs: 1000,
    generate: async ({ attempt }) => candidate(attempt, { comparison: comparisons[attempt - 1]! }),
  })
  assert({
    given: 'isolated stalls separated by actual pairwise improvements',
    should: 'continue to the cap and retain the last improvement',
    actual: [result.best.id, result.summary.used, result.summary.stopped],
    expected: [5, 5, 'attempt_limit'],
  })
})

test('Unavailable reviews and the absence of actionable feedback stop automatic spending', async () => {
  const images: Candidate[] = [
    candidate(1, {}, 'unavailable'),
    { id: 2, data: new Uint8Array([2]) },
    candidate(3, { verdict: 'uncertain', correction: '   ', checks: passedReview.checks }),
  ]
  const results: Array<Awaited<ReturnType<typeof runImageAttempts<Candidate>>>> = []
  for (const image of images) {
    results.push(await runImageAttempts<Candidate>({ maxAttempts: 5, budgetMs: 1000, generate: async () => image }))
  }
  assert({
    given: 'a review outage, missing review data and an uncertain review with no reliable correction',
    should: 'return the available image without initiating a speculative retry',
    actual: results.map((result) => [result.best.id, result.summary.used, result.summary.stopped]),
    expected: [
      [1, 1, 'review_unavailable'],
      [2, 1, 'review_unavailable'],
      [3, 1, 'stalled'],
    ],
  })
})

test('Failed checks remain actionable even when no separate correction text was returned', async () => {
  const feedback: Array<string | undefined> = []
  const result = await runImageAttempts<Candidate>({
    maxAttempts: 3,
    budgetMs: 1000,
    generate: async ({ attempt, feedback: instructions }) => {
      feedback.push(instructions)
      return candidate(attempt, attempt === 1 ? { correction: '' } : { ...passedReview, comparison: 'better' })
    },
  })
  assert({
    given: 'a concrete failed check without extra correction prose',
    should: 'carry its detail into the correction and stop at the passing result',
    actual: [feedback[0], feedback[1]?.includes('Attempt 1 is too far left.'), result.summary.stopped, result.best.id],
    expected: [undefined, true, 'passed', 2],
  })
})

test('A passing verdict with failed checks cannot terminate the loop as successful', async () => {
  const result = await runImageAttempts<Candidate>({
    maxAttempts: 1,
    budgetMs: 1000,
    generate: async () => candidate(1, { verdict: 'pass' }, 'passed'),
  })
  assert({
    given: 'a contradictory assessment that says pass while a required check failed',
    should: 'retain the image without reporting a successful review',
    actual: [result.best.id, result.summary.stopped],
    expected: [1, 'attempt_limit'],
  })
})

test('A contradictory passing result cannot replace a pairwise better retained candidate', async () => {
  const result = await runImageAttempts<Candidate>({
    maxAttempts: 2,
    budgetMs: 1000,
    generate: async ({ attempt }) => candidate(attempt, attempt === 1 ? {} : { ...passedReview, comparison: 'worse' }),
  })
  assert({
    given: 'a later result marked pass but explicitly judged worse than the retained best',
    should: 'keep the earlier best rather than letting the passing label override pairwise quality',
    actual: [result.best.id, result.summary.selected],
    expected: [1, 1],
  })
})

test('Time expiry retains the first protected checkpoint while incomplete review work is cancelled', async () => {
  const protectedImage = candidate(1, {}, 'unavailable')
  const result = await runImageAttempts<Candidate>({
    maxAttempts: 5,
    budgetMs: 10,
    generate: async ({ checkpoint, signal }) => {
      checkpoint(protectedImage)
      await new Promise<never>((_resolve, reject) => {
        if (signal.aborted) reject(signal.reason)
        else signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
      throw new Error('Unreachable after cancellation.')
    },
  })
  assert({
    given: 'a protected composite exists before its review exceeds the time budget',
    should: 'return exactly that checkpoint and classify the stop as time limited',
    actual: [
      [...result.best.data],
      result.versions.length,
      result.summary.selected,
      result.summary.used,
      result.summary.stopped,
    ],
    expected: [[...protectedImage.data], 1, 1, 1, 'time_limit'],
  })
})

test('A successful provider response received after the deadline retains its image but reports the time limit', async () => {
  const result = await runImageAttempts<Candidate>({
    maxAttempts: 5,
    budgetMs: 5,
    generate: async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 15))
      return candidate(1, passedReview)
    },
  })
  assert({
    given: 'a provider finishes after the budget instead of rejecting its aborted signal',
    should: 'retain its available image but never claim the work completed within budget',
    actual: [result.best.id, result.summary.used, result.summary.stopped],
    expected: [1, 1, 'time_limit'],
  })
})

test('Later generation failures retain the best and any newer preservation checkpoint as separate versions', async () => {
  const outputs: Array<Awaited<ReturnType<typeof runImageAttempts<Candidate>>>> = []
  for (const useCheckpoint of [false, true]) {
    outputs.push(
      await runImageAttempts<Candidate>({
        maxAttempts: 5,
        budgetMs: 1000,
        generate: async ({ attempt, checkpoint }) => {
          if (attempt === 1) return candidate(1)
          if (useCheckpoint) checkpoint(candidate(2, {}, 'unavailable'))
          throw new Error('Synthetic provider failure.')
        },
      }),
    )
  }
  assert({
    given: 'an earlier reviewed candidate and a failed later attempt, optionally with a protected checkpoint',
    should: 'preserve the best and all available versions while reporting the failed attempt',
    actual: outputs.map((result) => [
      result.best.id,
      result.versions.map((version) => version.id),
      result.summary.used,
      result.summary.selected,
      result.summary.stopped,
      result.summary.error,
    ]),
    expected: [
      [1, [1], 2, 1, 'generation_error', 'Synthetic provider failure.'],
      [1, [1, 2], 2, 1, 'generation_error', 'Synthetic provider failure.'],
    ],
  })
})

test('A failed first generation without a checkpoint propagates the underlying error', async () => {
  let failure = ''
  try {
    await runImageAttempts<Candidate>({
      maxAttempts: 3,
      budgetMs: 1000,
      generate: async () => {
        throw new Error('Synthetic first attempt failure.')
      },
    })
  } catch (error) {
    failure = (error as Error).message
  }
  assert({
    given: 'no complete image exists when the first generation fails',
    should: 'propagate the original error instead of fabricating a successful result',
    actual: failure,
    expected: 'Synthetic first attempt failure.',
  })
})

test('User cancellation propagates even after the best image or a checkpoint is available', async () => {
  const failures: string[] = []
  for (const stage of ['before', 'checkpoint', 'later'] as const) {
    const controller = new AbortController()
    if (stage === 'before') controller.abort(new Error('User cancelled.'))
    try {
      await runImageAttempts<Candidate>({
        maxAttempts: 3,
        budgetMs: 1000,
        signal: controller.signal,
        generate: async ({ attempt, checkpoint }) => {
          if (stage === 'later' && attempt === 1) return candidate(1)
          checkpoint(candidate(attempt))
          controller.abort(new Error('User cancelled.'))
          return candidate(attempt)
        },
      })
    } catch (error) {
      failures.push((error as Error).message)
    }
  }
  assert({
    given: 'the user cancels before rendering, after a checkpoint or during a later correction',
    should: 'honor cancellation consistently instead of swallowing it as a provider failure',
    actual: failures,
    expected: ['User cancelled.', 'User cancelled.', 'User cancelled.'],
  })
})

test('Adaptive attempt and time budget bounds reject invalid values before generation', async () => {
  const invalid = [
    { maxAttempts: 0, budgetMs: 1000 },
    { maxAttempts: 6, budgetMs: 1000 },
    { maxAttempts: 2.5, budgetMs: 1000 },
    { maxAttempts: Number.NaN, budgetMs: 1000 },
    { maxAttempts: 3, budgetMs: 0 },
    { maxAttempts: 3, budgetMs: -1 },
    { maxAttempts: 3, budgetMs: Number.POSITIVE_INFINITY },
    { maxAttempts: 3, budgetMs: Number.NaN },
  ]
  let generated = 0
  let rejected = 0
  for (const options of invalid) {
    try {
      await runImageAttempts<Candidate>({
        ...options,
        generate: async () => {
          generated++
          return candidate(1)
        },
      })
    } catch {
      rejected++
    }
  }
  assert({
    given: 'invalid attempt counts and time budgets',
    should: 'reject all requests before any provider call',
    actual: [rejected, generated],
    expected: [invalid.length, 0],
  })
})
