import sharp from 'sharp'
import { assessImage } from './assess.ts'
import { lastAssessment, runImageAttempts } from './attempts.ts'
import type { AttemptSummary } from './attempts.ts'
import { planDrawing, renderDrawing } from './drawing/mod.ts'
import type { DrawingScene } from './drawing/mod.ts'
import { preserveDrawing } from './drawingPreservation.ts'
import { finishImageEdit } from './finish.ts'
import type { ImageReviewSummary } from './finish.ts'
import { compositeImageEdit } from './mask.ts'
import type { MaskedImageEdit } from './mask.ts'
import { planMixedImage } from './mixed.ts'
import type { MixedImagePlan } from './mixed.ts'
import type { ImageBackground } from './options.ts'
import type { ImageSelection, ImageMethod } from './preflight.ts'
import type { ImageReference } from './references.ts'
import { refineImageMask } from './refine.ts'
import { renderImages } from './render.ts'
import type { RenderedImage } from './render.ts'
import { graphicEditSize } from './resolution.ts'

export interface ImageWorkflowRequest {
  prompt: string
  brief?: string
  selection: ImageSelection
  refs: readonly ImageReference[]
  count: number
  size?: string
  edit?: MaskedImageEdit
  background?: ImageBackground
  maxAttempts?: number
  budgetMs?: number
  focus?: boolean
  signal?: AbortSignal
  onProgress?: (message: string) => void
}

export interface WorkflowVersion extends RenderedImage {
  method: ImageMethod
  svg?: string
  drawingScene?: DrawingScene
  feedback?: string
  artwork?: Uint8Array
  artworkMask?: ImageReference
  artworkGeneration?: RenderedImage
  mixedPlan?: MixedImagePlan
  refinedMask?: ImageReference
}

export interface WorkflowImage extends WorkflowVersion {
  attempts: AttemptSummary
  versions: WorkflowVersion[]
  batchWarning?: string
}

const pendingReview = (): ImageReviewSummary => ({
  status: 'unavailable',
  reason: 'The image is available, but its visual review did not finish.',
  maskAdjusted: false,
  assessments: [],
})

const dependencies = {
  renderImages,
  planDrawing,
  renderDrawing,
  planMixedImage,
  refineImageMask,
  finishImageEdit,
  assessImage,
  preserveDrawing,
}
export type ImageWorkflowDependencies = typeof dependencies

/** Image generation returns the provider result directly unless masking or reviewed attempts were requested. */
export async function runImageWorkflow(
  request: ImageWorkflowRequest,
  overrides: Partial<ImageWorkflowDependencies> = {},
): Promise<WorkflowImage[]> {
  const deps = { ...dependencies, ...overrides }
  const start = performance.now()
  const budgetMs = request.budgetMs ?? 15 * 60_000
  const maxAttempts = request.maxAttempts ?? (request.selection.complexity === 'complex' ? 5 : 3)
  const results: WorkflowImage[] = []
  if (!Number.isInteger(request.count) || request.count < 1 || request.count > 4)
    throw new Error('Image count must be between 1 and 4.')
  for (let index = 0; index < request.count; index++) {
    request.signal?.throwIfAborted()
    const remainingMs = budgetMs - (performance.now() - start)
    if (remainingMs <= 0 && results.length) {
      results[0]!.batchWarning = `Created ${results.length} of ${request.count} images before the time budget expired.`
      break
    }
    request.onProgress?.(`Creating image ${index + 1} of ${request.count} with ${request.selection.method}…`)
    let run
    try {
      run =
        request.selection.method === 'image' && !request.edit && request.maxAttempts === undefined
          ? await renderUnreviewedImage(request, deps, remainingMs)
          : await runImageAttempts<WorkflowVersion>({
              maxAttempts,
              budgetMs: remainingMs,
              signal: request.signal,
              onProgress: request.onProgress,
              generate: async ({ feedback, previous, signal, checkpoint }) => {
                const input = { ...request, signal }
                const candidate = await produceImage(input, deps, feedback, previous, checkpoint)
                let edit = request.edit
                if (edit && candidate.method === 'image') {
                  // Keep a safe result before another model call, including when the time budget expires during refinement.
                  candidate.data = await compositeImageEdit(candidate.generated, edit, signal)
                  candidate.review = pendingReview()
                  checkpoint({ ...candidate })
                  const mask = await deps.refineImageMask({
                    prompt: request.prompt,
                    brief: request.brief,
                    generated: candidate.generated,
                    edit,
                    signal,
                  })
                  candidate.refinedMask = mask
                  edit = { ...edit, mask }
                }
                if (edit && candidate.method !== 'image') {
                  // Exact vector coverage has already been bounded; visual review must not expand it.
                  edit = {
                    ...edit,
                    mask: candidate.mask ?? edit.mask,
                    generationMask: candidate.mask ?? edit.mask,
                    plan: undefined,
                  }
                }
                if (edit) candidate.data = await compositeImageEdit(candidate.generated, edit, signal)
                candidate.review = pendingReview()
                checkpoint({ ...candidate })
                const prior = previous ? { data: previous.data, assessment: lastAssessment(previous) } : undefined
                if (edit) {
                  const finished = await deps.finishImageEdit({
                    prompt: request.prompt,
                    brief: request.brief,
                    generated: candidate.generated,
                    edit,
                    previous: prior,
                    rawArtwork: candidate.artworkGeneration?.generated,
                    signal,
                    onProgress: request.onProgress,
                  })
                  return { ...candidate, ...finished }
                }
                request.onProgress?.('Reviewing the result against the request…')
                try {
                  const assessment = await deps.assessImage({
                    prompt: request.prompt,
                    brief: request.brief,
                    data: candidate.data,
                    refs: request.refs,
                    complexity: request.selection.complexity,
                    previous: prior,
                    signal,
                  })
                  candidate.review = {
                    status:
                      assessment.verdict === 'pass' && assessment.checks.every((check) => check.passed)
                        ? 'passed'
                        : 'needs_revision',
                    reason: assessment.reason,
                    maskAdjusted: false,
                    assessments: [assessment],
                  }
                } catch {
                  signal.throwIfAborted()
                }
                return candidate
              },
            })
    } catch (error) {
      request.signal?.throwIfAborted()
      if (!results.length) throw error
      results[0]!.batchWarning = `Created ${results.length} of ${request.count} images. The next image failed: ${error instanceof Error ? error.message : String(error)}`
      break
    }
    results.push({ ...run.best, attempts: run.summary, versions: run.versions })
    request.onProgress?.(
      run.summary.stopped === 'completed'
        ? `Created image ${index + 1} of ${request.count}.`
        : `Retained attempt ${run.summary.selected} of ${run.summary.used}: ${run.best.review?.reason ?? run.summary.stopped}`,
    )
    if (run.summary.stopped === 'time_limit') {
      if (results.length < request.count)
        results[0]!.batchWarning = `Created ${results.length} of ${request.count} images before the time budget expired.`
      break
    }
  }
  return results
}

async function renderUnreviewedImage(
  request: ImageWorkflowRequest,
  deps: ImageWorkflowDependencies,
  budgetMs: number,
): Promise<{ best: WorkflowVersion; versions: WorkflowVersion[]; summary: AttemptSummary }> {
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) throw new Error('The image time budget must be positive.')
  const start = performance.now()
  const timeout = AbortSignal.timeout(Math.ceil(budgetMs))
  const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout
  const image = await produceImage({ ...request, signal, focus: false }, deps)
  signal.throwIfAborted()
  return {
    best: image,
    versions: [image],
    summary: { limit: 1, used: 1, selected: 1, stopped: 'completed', elapsedMs: Math.round(performance.now() - start) },
  }
}

async function drawingCanvas(request: ImageWorkflowRequest): Promise<{ width: number; height: number }> {
  if (request.size && request.size !== 'auto') {
    const [width, height] = request.size.split('x').map(Number)
    return { width: width!, height: height! }
  }
  if (request.edit || (request.refs.length && !['create', 'transform'].includes(request.selection.intent))) {
    const { width, height } = await sharp((request.edit?.canvas ?? request.refs[0]!).data).metadata()
    if (request.selection.method === 'mixed' && !request.edit) {
      const [canvasWidth, canvasHeight] = graphicEditSize(width, height).split('x').map(Number)
      return { width: canvasWidth!, height: canvasHeight! }
    }
    return { width, height }
  }
  return request.selection.layout === 'portrait'
    ? { width: 1024, height: 1536 }
    : request.selection.layout === 'landscape'
      ? { width: 1536, height: 1024 }
      : { width: 1024, height: 1024 }
}

async function produceImage(
  request: ImageWorkflowRequest,
  deps: ImageWorkflowDependencies,
  feedback?: string,
  previous?: WorkflowVersion,
  checkpoint?: (candidate: WorkflowVersion) => void,
): Promise<WorkflowVersion> {
  const method = request.selection.method
  const render = async (prompt: string, edit = request.edit, size = request.size) => {
    const [image] = await deps.renderImages({
      prompt,
      brief: request.brief,
      refs: request.refs,
      count: 1,
      model: request.selection.model,
      quality: request.selection.quality,
      background: request.background,
      size,
      edit,
      signal: request.signal,
      onProgress: request.onProgress,
      finish: false,
      focus: request.focus !== false,
      feedback: method === 'mixed' ? undefined : feedback,
    })
    if (!image) throw new Error('The image provider returned no image.')
    return image
  }
  if (method === 'image') return { ...(await render(request.prompt)), method, feedback }

  const { width, height } = await drawingCanvas(request)
  let base =
    request.edit?.canvas.data ??
    (!['create', 'transform'].includes(request.selection.intent) ? request.refs[0]?.data : undefined)
  let drawingPrompt = request.prompt
  let mixedPlan: MixedImagePlan | undefined
  let raster: RenderedImage | undefined
  let artworkMask: ImageReference | undefined
  if (method === 'mixed') {
    request.onProgress?.('Planning artwork and precise graphic layers…')
    mixedPlan = await deps.planMixedImage({
      prompt: request.prompt,
      brief: request.brief,
      width,
      height,
      feedback,
      previousPlan: previous?.mixedPlan,
      refs: previous?.artwork
        ? [{ name: 'current-artwork.png', mediaType: 'image/png', data: previous.artwork }, ...request.refs]
        : request.refs,
      signal: request.signal,
    })
    if (previous?.artwork && !mixedPlan.regenerateArtwork) {
      request.onProgress?.('Keeping the artwork and revising the graphic layers…')
      base = previous.artwork
      artworkMask = previous.artworkMask
      raster = previous.artworkGeneration
    } else {
      request.onProgress?.('Creating the artwork layer…')
      // The raster brief excludes precise overlay content. Keep geometry, but do not
      // append the original full-request lettering requirements to that prompt.
      const artworkEdit = request.edit && {
        ...request.edit,
        plan: request.edit.plan && { ...request.edit.plan, changes: mixedPlan.artworkPrompt, requirements: [] },
      }
      raster = await render(mixedPlan.artworkPrompt, artworkEdit, `${width}x${height}`)
      artworkMask = request.edit?.generationMask ?? request.edit?.mask
      base = request.edit
        ? await compositeImageEdit(raster.generated, { ...request.edit, mask: artworkMask! }, request.signal)
        : raster.data
      const retainArtwork = () =>
        checkpoint?.({
          ...raster!,
          data: base!,
          method,
          feedback,
          mixedPlan,
          artwork: base,
          artworkMask,
          artworkGeneration: raster,
          mask: artworkMask,
          review: pendingReview(),
        })
      retainArtwork()
      if (request.edit) {
        request.onProgress?.('Checking the artwork boundaries and preserving the surrounding image…')
        artworkMask =
          mixedPlan.artworkScope === 'surface'
            ? request.edit.mask
            : await deps.refineImageMask({
                prompt: mixedPlan.artworkPrompt,
                generated: raster.generated,
                edit: request.edit,
                signal: request.signal,
              })
        base = await compositeImageEdit(raster.generated, { ...request.edit, mask: artworkMask }, request.signal)
        retainArtwork()
      }
    }
    drawingPrompt = mixedPlan.drawingPrompt
  }
  if (base) {
    const metadata = await sharp(base).metadata()
    if (metadata.width !== width || metadata.height !== height)
      base = await sharp(base)
        .resize({ width, height, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer()
  }
  request.onProgress?.('Drawing precise shapes and text…')
  const scene = await deps.planDrawing({
    prompt: drawingPrompt,
    brief: request.brief,
    width,
    height,
    refs: base
      ? [
          { name: method === 'mixed' ? 'artwork-base.png' : 'drawing-base.png', mediaType: 'image/png', data: base },
          ...(method === 'mixed' ? [] : request.refs.slice(1)),
        ]
      : [...request.refs],
    mode: method === 'mixed' ? 'overlay' : base ? 'edit' : 'create',
    complexity: request.selection.complexity,
    feedback,
    previousScene: previous?.drawingScene,
    constraints: [
      request.edit
        ? `Preserve the base outside the allowed regions. ${request.edit.description} ${JSON.stringify(request.edit.plan ?? {})}`
        : '',
      request.background === 'transparent'
        ? 'Keep the canvas background transparent.'
        : request.background === 'opaque'
          ? 'Use an opaque background.'
          : '',
    ]
      .filter(Boolean)
      .join('\n'),
    signal: request.signal,
  })
  const drawing = await deps.renderDrawing(scene, { base, signal: request.signal })
  let result = { data: drawing.data, svg: drawing.svg, mask: undefined as ImageReference | undefined }
  if (request.edit) {
    // Include observed artwork boundaries as well as the exact overlay coverage.
    const coverage = method === 'mixed' ? await artworkCoverage(drawing.coverage, artworkMask) : drawing.coverage
    result = await deps.preserveDrawing({ ...drawing, coverage }, request.edit, request.signal)
  }
  return {
    ...raster,
    ...result,
    generated: drawing.data,
    generationPrompt: raster?.generationPrompt ?? drawingPrompt,
    method,
    feedback,
    drawingScene: scene,
    mixedPlan,
    artwork: method === 'mixed' ? base : undefined,
    artworkMask,
    artworkGeneration: raster,
    background: request.background,
  }
}

async function artworkCoverage(drawing: Uint8Array, mask?: ImageReference): Promise<Uint8Array> {
  if (!mask) return drawing
  const { width, height } = await sharp(drawing).metadata()
  const rgba = await sharp(drawing).ensureAlpha().raw().toBuffer()
  const alpha = await sharp(mask.data).extractChannel('alpha').raw().toBuffer()
  if (rgba.length !== alpha.length * 4) throw new Error('Artwork coverage dimensions do not match the drawing.')
  for (let i = 0; i < alpha.length; i++) if (alpha[i]! < 255) rgba[i * 4 + 3] = 255
  return sharp(rgba, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer()
}
