import type { ImageMethod } from './preflight.ts'

const stageLabels = {
  'image:generate': 'OpenAI image generation',
  'image:edit': 'OpenAI image editing',
  'drawing:plan': 'SVG drawing planning',
  'drawing:render': 'SVG rendering',
  'mixed:plan': 'Mixed artwork and SVG planning',
} as const

type ImageStage = keyof typeof stageLabels

export class ImageStageError extends Error {
  constructor(
    readonly stage: ImageStage,
    cause: unknown,
  ) {
    super(`${stageLabels[stage]} failed: ${cause instanceof Error ? cause.message : String(cause)}`, { cause })
    this.name = 'ImageStageError'
  }
}

export async function runImageStage<T>(stage: ImageStage, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof ImageStageError) throw error
    throw new ImageStageError(stage, error)
  }
}

export function imageFailureMessage(
  error: unknown,
  method: ImageMethod,
  budgetMinutes: number,
  budgetExpired: boolean,
): string {
  const label =
    error instanceof ImageStageError
      ? stageLabels[error.stage]
      : method === 'drawing'
        ? 'SVG drawing'
        : method === 'mixed'
          ? 'Mixed image creation'
          : 'OpenAI image generation'
  if (budgetExpired) {
    return `${label} stopped because the ${budgetMinutes}-minute request budget expired. No image was returned. Retry with a longer time budget.`
  }
  const message =
    error instanceof ImageStageError
      ? error.message
      : `${label} failed: ${error instanceof Error ? error.message : String(error)}`
  return `${message} No image was returned.`
}
