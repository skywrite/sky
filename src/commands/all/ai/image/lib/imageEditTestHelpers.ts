import type { ImageMaskPlan } from './maskPlan.ts'
import type { ImageEditAssessment } from './review.ts'

export const testRegion = (left: number, top: number, right: number, bottom: number) => ({
  label: 'Synthetic region',
  points: [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ],
})

export function testMaskPlan(
  editRegions = [testRegion(300, 300, 700, 700)],
  protectedRegions: ImageMaskPlan['protectedRegions'] = [],
): ImageMaskPlan {
  return {
    scope: 'localized',
    reason: 'Change the center tile while preserving the surrounding design.',
    changes: 'A new center tile occupying the requested footprint.',
    requirements: ['Replace the center tile.', 'Preserve the surrounding design and protected inset.'],
    edges: 'soft',
    generationRegions: [testRegion(100, 100, 900, 900)],
    editRegions,
    protectedRegions,
  }
}

export const passedReview: ImageEditAssessment = {
  verdict: 'pass',
  reason: 'The requested tile changed and the surrounding design is preserved.',
  checks: [
    {
      requirement: 'Replace the tile and preserve the surrounding design.',
      passed: true,
      detail: 'The composite matches the request.',
    },
  ],
  editRegions: [],
}
