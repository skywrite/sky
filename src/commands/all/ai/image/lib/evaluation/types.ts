export interface EvaluationBounds {
  left: number
  top: number
  width: number
  height: number
}

export interface ImageEvaluationDefinition {
  id: string
  medium: 'synthetic_scene' | 'graphic' | 'diagram' | 'transparent' | 'mixed'
  prompt: string
  visualRequirements: string[]
}

export interface EvaluationColorTarget {
  name: string
  bounds: EvaluationBounds
  color: readonly [number, number, number]
  tolerance: number
  mask: Uint8Array
  minimumIntersectionOverUnion: number
  maximumCenterError: number
}

export interface ImageEvaluationFixture {
  definition: ImageEvaluationDefinition
  width: number
  height: number
  source: Uint8Array
  /** Opaque pixels must remain identical; transparent pixels may change. */
  protectedMask: Uint8Array
  /** A deterministic example for calibration, never a supplied model reference. */
  example: Uint8Array
  targets: EvaluationColorTarget[]
  transparentTargets?: { name: string; mask: Uint8Array }[]
}

export interface EvaluationTargetMetrics {
  name: string
  expectedPixels: number
  actualPixels: number
  intersectionOverUnion: number
  precision: number
  recall: number
  centerError: number | null
  actualBounds: EvaluationBounds | null
  passed: boolean
}

export interface ImageEvaluationMetrics {
  dimensions: { expected: [number, number]; actual: [number, number]; passed: boolean }
  preservation: {
    protectedPixels: number
    changedPixels: number
    maximumChannelDifference: number
    passed: boolean
  } | null
  transparency: {
    protectedTransparentPixels: number
    changedProtectedAlphaPixels: number
    sourceTransparentPixels: number
    outputTransparentPixels: number
    passed: boolean
  } | null
  targets: EvaluationTargetMetrics[]
  transparentTargets: { name: string; pixels: number; nontransparentPixels: number; passed: boolean }[]
  /** Numeric checks only. This does not establish visual or semantic correctness. */
  objectivePassed: boolean
  visualRequirements: string[]
}

export interface ImageEvaluationReview {
  status: 'passed' | 'needs_revision' | 'unavailable'
  reason?: string
}

export interface ImageEvaluationUsage {
  inputTokens?: number
  outputTokens?: number
  imageGenerations?: number
}

export interface ImageEvaluationOutput {
  data: Uint8Array
  review?: ImageEvaluationReview
  usage?: ImageEvaluationUsage
  costUsd?: number
  artifacts?: Record<string, string>
}

export interface ImageEvaluationAttempt {
  attempt: number
  latencyMs: number
  metrics?: ImageEvaluationMetrics
  review?: ImageEvaluationReview
  usage?: ImageEvaluationUsage
  costUsd?: number
  artifacts?: Record<string, string>
  error?: string
}

export interface ImageEvaluationRequest {
  fixture: ImageEvaluationFixture
  attempt: number
  previous?: ImageEvaluationAttempt
  signal: AbortSignal
  remaining: { durationMs: number; attempts: number; costUsd?: number }
}

export interface ImageEvaluationOptions {
  generate: (request: ImageEvaluationRequest) => Promise<ImageEvaluationOutput>
  caseIds?: string[]
  maxAttemptsPerCase?: number
  maxTotalAttempts?: number
  maxDurationMs?: number
  maxCostUsd?: number
  /** Required with a cost limit; reserve this upper estimate before each callback. */
  estimatedAttemptCostUsd?: number
  signal?: AbortSignal
  onAttempt?: (
    fixture: ImageEvaluationFixture,
    output: ImageEvaluationOutput,
    attempt: ImageEvaluationAttempt,
  ) => Promise<void>
}

export interface ImageEvaluationCaseResult {
  id: string
  status: 'objective_pass' | 'failed' | 'incomplete'
  visualRequirements: string[]
  attempts: ImageEvaluationAttempt[]
  bestAttempt?: number
  stopReason: 'passed' | 'attempt_limit' | 'time_limit' | 'cost_limit' | 'cost_unavailable' | 'stalled'
}

export interface ImageEvaluationReport {
  version: 1
  scope: 'objective_metrics_with_separate_visual_review'
  cases: ImageEvaluationCaseResult[]
  totals: {
    objectivePasses: number
    failures: number
    incomplete: number
    attempts: number
    latencyMs: number
    reportedCostUsd: number
    costComplete: boolean
    usage: ImageEvaluationUsage
    usageComplete: boolean
  }
}
