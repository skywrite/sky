import { compositeImageEdit, limitEditMask, maskFromPlan } from './mask.ts'
import type { MaskedImageEdit } from './mask.ts'
import type { ImageReference } from './references.ts'
import { imageReviewSchema, reviewImageEdit } from './review.ts'
import type { ImageEditAssessment } from './review.ts'

export interface ImageReviewSummary {
  status: 'passed' | 'needs_revision' | 'unavailable'
  reason: string
  maskAdjusted: boolean
  assessments: ImageEditAssessment[]
}

export interface FinishedImageEdit {
  data: Uint8Array
  mask: ImageReference
  review: ImageReviewSummary
}

/** One bounded mask correction can reuse a paid generation. A review outage must not discard its protected composite. */
export async function finishImageEdit(
  request: {
    prompt: string
    brief?: string
    generated: Uint8Array
    /** Uncomposited raster before mixed artwork preservation and vector overlays. */
    rawArtwork?: Uint8Array
    edit: MaskedImageEdit
    signal?: AbortSignal
    onProgress?: (message: string) => void
    previous?: { data: Uint8Array; assessment?: ImageEditAssessment }
  },
  reviewer: typeof reviewImageEdit = reviewImageEdit,
): Promise<FinishedImageEdit> {
  let edit = request.edit
  let data = await compositeImageEdit(request.generated, edit, request.signal)
  const assessments: ImageEditAssessment[] = []
  let maskAdjusted = false
  const result = (status: ImageReviewSummary['status'], reason: string): FinishedImageEdit => ({
    data,
    mask: edit.mask,
    review: { status, reason, maskAdjusted, assessments },
  })
  for (let round = 0; round < 2; round++) {
    request.signal?.throwIfAborted()
    request.onProgress?.(round === 0 ? 'Checking the edit and the preserved areas…' : 'Checking the adjusted edges…')
    let assessment: ImageEditAssessment
    try {
      assessment = imageReviewSchema.parse(
        await reviewer({
          ...request,
          edit,
          composite: data,
          allowMaskRevision: round === 0 && !!edit.plan && !!edit.generationMask,
        }),
      )
      request.signal?.throwIfAborted()
    } catch {
      request.signal?.throwIfAborted()
      return result(
        'unavailable',
        'The image was saved with protected areas preserved, but its visual review could not be completed.',
      )
    }
    assessments.push(assessment)
    if (assessment.verdict === 'pass') {
      const failed = assessment.checks.filter((check) => !check.passed)
      return failed.length
        ? result('needs_revision', failed.map((check) => check.detail).join(' '))
        : result('passed', assessment.reason)
    }
    if (assessment.verdict !== 'revise_mask' || round !== 0 || !edit.plan || !edit.generationMask)
      return result('needs_revision', assessment.reason)
    try {
      const proposed = await maskFromPlan(
        { ...edit.plan, editRegions: assessment.editRegions },
        edit.canvas,
        request.signal,
      )
      const mask = await limitEditMask(proposed, edit.generationMask, edit.canvas, request.signal)
      const corrected = await compositeImageEdit(request.generated, { ...edit, mask }, request.signal)
      edit = { ...edit, mask }
      data = corrected
      maskAdjusted = true
    } catch {
      request.signal?.throwIfAborted()
      return result(
        'needs_revision',
        `${assessment.reason} The suggested edge correction could not be applied within the preservation limits.`,
      )
    }
  }
  return result('needs_revision', 'The edit needs another visual review.')
}
