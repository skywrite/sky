import type { ImageReviewSummary } from './finish.ts'

export interface ReviewedImage {
  data: Uint8Array
  review?: ImageReviewSummary
}

export interface AttemptSummary {
  limit: number
  used: number
  selected: number
  stopped:
    | 'completed'
    | 'passed'
    | 'stalled'
    | 'attempt_limit'
    | 'time_limit'
    | 'review_unavailable'
    | 'generation_error'
  elapsedMs: number
  error?: string
}

export const lastAssessment = (image?: ReviewedImage) => image?.review?.assessments.at(-1)

/** A bounded adaptive loop; retain every completed candidate and never replace the best with a regression. */
export async function runImageAttempts<T extends ReviewedImage>(request: {
  maxAttempts: number
  budgetMs: number
  signal?: AbortSignal
  onProgress?: (message: string) => void
  generate: (input: {
    attempt: number
    feedback?: string
    previous?: T
    signal: AbortSignal
    checkpoint: (candidate: T) => void
  }) => Promise<T>
}): Promise<{ best: T; versions: T[]; summary: AttemptSummary }> {
  if (!Number.isInteger(request.maxAttempts) || request.maxAttempts < 1 || request.maxAttempts > 5)
    throw new Error('Image attempts must be between 1 and 5.')
  if (!Number.isFinite(request.budgetMs) || request.budgetMs <= 0)
    throw new Error('The image time budget must be positive.')
  request.signal?.throwIfAborted()
  const start = performance.now()
  const timeout = AbortSignal.timeout(Math.ceil(request.budgetMs))
  const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout
  const versions: T[] = []
  let best: T | undefined
  let selected = 0
  let stalled = 0
  let used = 0
  let stopped: AttemptSummary['stopped'] = 'attempt_limit'
  let error: string | undefined
  for (let attempt = 1; attempt <= request.maxAttempts; attempt++) {
    request.signal?.throwIfAborted()
    if (signal.aborted) {
      stopped = 'time_limit'
      break
    }
    const feedback = correctionFeedback(best, versions.at(-1))
    request.onProgress?.(
      `Attempt ${attempt} of ${request.maxAttempts}${attempt > 1 ? ': correcting the previous result' : ''}…`,
    )
    used = attempt
    let checkpoint: T | undefined
    let candidate: T
    try {
      candidate = await request.generate({
        attempt,
        feedback,
        previous: best,
        signal,
        checkpoint: (image) => {
          checkpoint = image
        },
      })
      request.signal?.throwIfAborted()
    } catch (failure) {
      request.signal?.throwIfAborted()
      if (checkpoint) {
        versions.push(checkpoint)
        if (!best) {
          best = checkpoint
          selected = versions.length
        }
      }
      if (!best) throw failure
      stopped = timeout.aborted ? 'time_limit' : 'generation_error'
      error = failure instanceof Error ? failure.message : String(failure)
      break
    }
    versions.push(candidate)
    const result = lastAssessment(candidate)
    const passed =
      candidate.review?.status === 'passed' &&
      result?.verdict === 'pass' &&
      result.checks.every((check) => check.passed)
    const improved = !best || result?.comparison === 'better'
    if (improved) {
      best = candidate
      selected = versions.length
      stalled = 0
    } else stalled++
    if (timeout.aborted) {
      stopped = 'time_limit'
      break
    }
    if (passed && improved) {
      stopped = 'passed'
      break
    }
    if (candidate.review?.status === 'unavailable' || !result) {
      stopped = 'review_unavailable'
      break
    }
    if (stalled >= 2 || !feedbackForRetry(candidate)) {
      stopped = 'stalled'
      break
    }
  }
  if (!best) throw new Error('The image time budget expired before an image was available.')
  return {
    best,
    versions,
    summary: {
      limit: request.maxAttempts,
      used,
      selected,
      stopped,
      elapsedMs: Math.round(performance.now() - start),
      error,
    },
  }
}

function feedbackForRetry(image: ReviewedImage): boolean {
  const assessment = lastAssessment(image)
  return !!assessment && (!!assessment.correction.trim() || assessment.checks.some((check) => !check.passed))
}

function correctionFeedback(best?: ReviewedImage, latest?: ReviewedImage): string | undefined {
  const assessment = lastAssessment(best)
  if (!assessment) return undefined
  const distinct = (lines: string[]) => [...new Set(lines.map((line) => line.trim()).filter(Boolean))].join('\n')
  const bestCorrections = distinct([
    assessment.correction,
    ...assessment.checks.filter((check) => !check.passed).map((check) => check.detail),
  ])
  const sections = [
    'The previous candidate is the retained best. Make these corrections using the original source while keeping its successful choices:',
    bestCorrections,
  ]
  // The next reviewer still compares against best. Rejected work supplies
  // failure notes only, so a correction does not repeat a regression or switch bases.
  if (latest && latest !== best) {
    const rejected = lastAssessment(latest)
    if (rejected) {
      sections.push(
        `Latest rejected attempt (${rejected.comparison}; notes only, not the previous best candidate):`,
        distinct([
          rejected.reason,
          rejected.correction,
          ...rejected.checks.filter((check) => !check.passed).map((check) => check.detail),
        ]),
        'Avoid repeating those defects. Continue from the retained best and the original request.',
      )
    }
  }
  return sections.filter(Boolean).join('\n')
}
