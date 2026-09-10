import sharp from 'sharp'
import { imageCanvas, limitEditMask, maskFromPlan, prepareExplicitMask } from './mask.ts'
import type { MaskedImageEdit } from './mask.ts'
import { planImageMask } from './maskPlan.ts'
import type { ImageDecision } from './preflight.ts'
import type { ImageReference } from './references.ts'
import { graphicEditSize, photoEditSize } from './resolution.ts'

export interface ImageEditRequest {
  prompt: string
  brief?: string
  refs: readonly ImageReference[]
  intent: ImageDecision['intent']
  complexity?: ImageDecision['complexity']
  size?: string
  mask?: 'auto' | 'none' | Uint8Array
  signal?: AbortSignal
}

export interface PreparedImageEdit {
  size?: string
  edit?: MaskedImageEdit
  preservation?: string
}

/** Geometry is independent of explicit model/quality choices. Classification decides when it applies. */
export async function prepareImageEdit(
  request: ImageEditRequest,
  planner: typeof planImageMask = planImageMask,
): Promise<PreparedImageEdit> {
  request.signal?.throwIfAborted()
  const reference = request.refs[0]
  const explicitMask = request.mask instanceof Uint8Array ? request.mask : undefined
  if (!reference) {
    if (explicitMask) throw new Error('A mask requires a reference image to edit.')
    return { size: request.size }
  }
  if (!['preserve_photo', 'preserve_image'].includes(request.intent) && !explicitMask) return { size: request.size }

  const { width, height } = await sharp(reference.data).metadata()
  const size =
    request.size && request.size !== 'auto'
      ? request.size
      : request.intent === 'preserve_photo'
        ? photoEditSize(width, height)
        : graphicEditSize(width, height)
  if (request.mask === 'none') return { size, preservation: 'Whole-image editing explicitly requested.' }
  const canvas = await imageCanvas(reference, size, request.signal)
  if (explicitMask) {
    const mask = await prepareExplicitMask(explicitMask, reference, canvas, request.signal)
    return {
      size,
      edit: {
        canvas,
        mask,
        generationMask: mask,
        complexity: request.complexity,
        description: 'User-supplied edit mask.',
      },
      preservation: 'Supplied mask; protected areas retain the original pixels at the output resolution.',
    }
  }
  const plan = await planner({
    prompt: request.prompt,
    brief: request.brief,
    reference: canvas,
    complexity: request.complexity,
    signal: request.signal,
  })
  request.signal?.throwIfAborted()
  if (plan.scope === 'uncertain')
    throw new Error(
      `Could not identify a reliable edit mask: ${plan.reason} Clarify the edit area or supply a PNG mask.`,
    )
  if (plan.scope === 'whole_image') return { size, preservation: `Whole-image edit: ${plan.reason}` }
  const generationMask = {
    ...(await maskFromPlan({ ...plan, editRegions: plan.generationRegions }, canvas, request.signal)),
    name: 'generation-mask.png',
  }
  const mask = await limitEditMask(
    await maskFromPlan(plan, canvas, request.signal),
    generationMask,
    canvas,
    request.signal,
  )
  return {
    size,
    edit: { canvas, mask, generationMask, plan, complexity: request.complexity, description: plan.changes },
    preservation: `Automatic mask: ${plan.reason} Protected areas retain the original pixels at the output resolution.`,
  }
}
