import sharp from 'sharp'
import { assert, test } from '#test'
import type { DrawingRequest } from './drawing/mod.ts'
import { drawingScene, drawingStar, solidStyle } from './drawing/testHelpers.ts'
import { finishImageEdit } from './finish.ts'
import { passedReview, testMaskPlan, testRegion } from './imageEditTestHelpers.ts'
import { imageCanvas, maskFromPlan } from './mask.ts'
import type { MaskedImageEdit } from './mask.ts'
import type { MixedImagePlan } from './mixed.ts'
import { IMAGE_MODELS, validateSize } from './options.ts'
import type { ImageMethod, ImageSelection } from './preflight.ts'
import type { ImageReference } from './references.ts'
import type { ImageRenderRequest } from './render.ts'
import type { ImageEditAssessment } from './review.ts'
import { runImageWorkflow } from './workflow.ts'
import type { ImageWorkflowDependencies } from './workflow.ts'

// Use the default workflow budget for real native rendering; Bun's test timeout bounds execution.
// Short budgets can cut corrections off on slow runners. Deadline behavior is covered in attempts_test.ts.
const noPaidCalls: Partial<ImageWorkflowDependencies> = {
  renderImages: async () => {
    throw new Error('Unexpected image API call.')
  },
  planDrawing: async () => {
    throw new Error('Unexpected drawing planner call.')
  },
  planMixedImage: async () => {
    throw new Error('Unexpected mixed planner call.')
  },
  refineImageMask: async () => {
    throw new Error('Unexpected contour planner call.')
  },
  finishImageEdit: async () => {
    throw new Error('Unexpected masked review call.')
  },
  assessImage: async () => {
    throw new Error('Unexpected general review call.')
  },
}

function selection(method: ImageMethod, intent: ImageSelection['intent'] = 'create'): ImageSelection {
  return {
    method,
    intent,
    layout: 'landscape',
    complexity: 'complex',
    model: IMAGE_MODELS.sunburst,
    quality: 'max',
    reason: 'Synthetic image workflow selection.',
  }
}

function correction(detail = 'The new icon should have eight points.'): ImageEditAssessment {
  return {
    ...passedReview,
    verdict: 'needs_revision',
    score: 45,
    comparison: 'first',
    correction: detail,
    checks: [{ requirement: 'Match the requested icon.', passed: false, detail }],
  }
}

async function solid(color: string, width = 128, height = 96): Promise<Uint8Array> {
  return sharp({ create: { width, height, channels: 4, background: color } })
    .png()
    .toBuffer()
}

async function protectedGraphic(): Promise<MaskedImageEdit> {
  const pixels = Buffer.alloc(128 * 96 * 4)
  for (let i = 0; i < pixels.length; i++) pixels[i] = i % 4 === 3 ? 96 + (i % 160) : (i * 73) % 256
  const data = await sharp(pixels, { raw: { width: 128, height: 96, channels: 4 } })
    .png()
    .toBuffer()
  const canvas: ImageReference = { name: 'graphic.png', mediaType: 'image/png', data }
  const regions = [testRegion(125, 167, 875, 833)]
  const plan = {
    ...testMaskPlan(regions, [testRegion(460, 440, 540, 560)]),
    edges: 'hard' as const,
    generationRegions: regions,
    changes: 'Replace the center icon, keeping the inset and surrounding artwork.',
  }
  const mask = await maskFromPlan(plan, canvas)
  return { canvas, mask, generationMask: mask, plan, description: plan.reason, complexity: 'complex' }
}

async function changedProtectedPixels(output: Uint8Array, edit: MaskedImageEdit): Promise<number> {
  const [before, after, alpha] = await Promise.all([
    sharp(edit.canvas.data).ensureAlpha().raw().toBuffer(),
    sharp(output).ensureAlpha().raw().toBuffer(),
    sharp((edit.generationMask ?? edit.mask).data)
      .extractChannel('alpha')
      .raw()
      .toBuffer(),
  ])
  let changed = 0
  for (let i = 0; i < alpha.length; i++) {
    if (alpha[i] === 255 && !before.subarray(i * 4, i * 4 + 4).equals(after.subarray(i * 4, i * 4 + 4))) changed++
  }
  return changed
}

test('Image corrections reuse the original source and preserve focus, refinement and review ordering', async () => {
  const edit = await protectedGraphic()
  const renders: ImageRenderRequest[] = []
  const refinedSources: Uint8Array[] = []
  const reviewSources: Array<Uint8Array | undefined> = []
  let reviews = 0
  const [result] = await runImageWorkflow(
    {
      prompt: 'Replace the center tile.',
      selection: selection('image', 'preserve_image'),
      refs: [edit.canvas],
      edit,
      size: '128x96',
      count: 1,
      maxAttempts: 3,
    },
    {
      ...noPaidCalls,
      renderImages: async (request) => {
        renders.push(request)
        const data = await solid(renders.length === 1 ? '#ee2200' : '#ff8800')
        return [{ data, generated: data, generationPrompt: request.prompt }]
      },
      refineImageMask: async (request) => {
        refinedSources.push(request.edit.canvas.data)
        return request.edit.mask
      },
      finishImageEdit: async (request) => {
        reviewSources.push(request.previous?.data)
        reviews++
        return finishImageEdit(request, async () =>
          reviews === 1 ? correction('Use the requested orange color.') : { ...passedReview, comparison: 'better' },
        )
      },
    },
  )
  assert({
    given: 'a localized image edit needs one correction after the first preserved composite',
    should: 'generate from the original each time, refine then review, and retain only protected final results',
    actual: [
      renders.length,
      renders.every((request) => request.refs[0] === edit.canvas && request.edit === edit),
      renders.map((request) => [request.count, request.focus, request.finish]),
      renders[1]!.feedback?.includes('requested orange'),
      refinedSources.every((data) => data === edit.canvas.data),
      refinedSources.length,
      reviews,
      reviewSources[0],
      reviewSources[1] === result!.versions[0]!.data,
      result!.attempts.stopped,
      result!.attempts.selected,
      await changedProtectedPixels(result!.data, edit),
      result!.refinedMask === edit.mask,
    ],
    expected: [
      2,
      true,
      [
        [1, true, false],
        [1, true, false],
      ],
      true,
      true,
      2,
      2,
      undefined,
      true,
      'passed',
      2,
      0,
      true,
    ],
  })
})

test('Image workflow honors an explicit request to disable focused rendering', async () => {
  let focused: boolean | undefined
  const data = await solid('#208080')
  await runImageWorkflow(
    {
      prompt: 'Create a graphic.',
      selection: selection('image'),
      refs: [],
      count: 1,
      focus: false,
      maxAttempts: 1,
    },
    {
      ...noPaidCalls,
      renderImages: async (request) => {
        focused = request.focus
        return [{ data, generated: data, generationPrompt: request.prompt }]
      },
      assessImage: async () => passedReview,
    },
  )
  assert({
    given: 'focus is explicitly disabled',
    should: 'pass that setting through to image rendering',
    actual: focused,
    expected: false,
  })
})

test('Precise graphic edits preserve original pixels and their SVG without invoking image generation', async () => {
  const edit = await protectedGraphic()
  const scene = drawingScene([drawingStar({ outerRadius: 32, innerRadius: 14 })])
  let request: DrawingRequest | undefined
  let fixedReview = false
  const [result] = await runImageWorkflow(
    {
      prompt: 'Add an orange eight-point star at the center.',
      selection: selection('drawing', 'preserve_image'),
      refs: [edit.canvas],
      edit,
      size: '128x96',
      count: 1,
      maxAttempts: 3,
    },
    {
      ...noPaidCalls,
      planDrawing: async (input) => {
        request = input
        return scene
      },
      finishImageEdit: async (input) => {
        fixedReview = !input.edit.plan && input.edit.mask === input.edit.generationMask
        return finishImageEdit(input, async () => passedReview)
      },
    },
  )
  const pixels = await sharp(result!.data).ensureAlpha().raw().toBuffer()
  const at = (x: number, y: number) => [...pixels.subarray((y * 128 + x) * 4, (y * 128 + x) * 4 + 4)]
  const insetBefore = await sharp(edit.canvas.data)
    .extract({ left: 64, top: 48, width: 1, height: 1 })
    .ensureAlpha()
    .raw()
    .toBuffer()
  const svgPixels = await sharp(Buffer.from(result!.svg!)).ensureAlpha().raw().toBuffer()
  assert({
    given: 'a mathematical star overlaps a protected inset on a raster design',
    should: 'use actual pixel coordinates, preserve the inset and outside, and retain a usable protected SVG',
    actual: [
      request?.mode,
      request?.width,
      request?.height,
      request?.refs?.[0]?.data === edit.canvas.data,
      at(64, 24),
      at(64, 48),
      await changedProtectedPixels(result!.data, edit),
      result!.svg?.includes('<polygon points='),
      result!.svg?.includes('sky-preserve'),
      svgPixels.length,
      fixedReview,
      result!.attempts.stopped,
      result!.drawingScene,
    ],
    expected: [
      'edit',
      128,
      96,
      true,
      [255, 128, 0, 255],
      [...insetBefore],
      0,
      true,
      true,
      128 * 96 * 4,
      true,
      'passed',
      scene,
    ],
  })
})

test('Pure drawing creation receives visual review and corrects exact geometry without image generation', async () => {
  const requests: DrawingRequest[] = []
  let reviews = 0
  const [result] = await runImageWorkflow(
    {
      prompt: 'Draw an orange eight-point star.',
      selection: selection('drawing'),
      refs: [],
      size: '128x96',
      count: 1,
      maxAttempts: 3,
    },
    {
      ...noPaidCalls,
      planDrawing: async (request) => {
        requests.push(request)
        return drawingScene([drawingStar({ points: requests.length === 1 ? 6 : 8 })])
      },
      assessImage: async () => {
        reviews++
        return reviews === 1 ? correction() : { ...passedReview, comparison: 'better' }
      },
    },
  )
  const polygonPoints = result!.svg!.match(/<polygon points="([^"]+)"/)![1]!.split(' ')
  assert({
    given: 'a first drawing has six points instead of the requested eight',
    should: 'review and correct the scene while keeping an editable final drawing and both versions',
    actual: [
      requests.map((request) => request.mode),
      requests[1]!.feedback?.includes('eight points'),
      requests[0]!.previousScene,
      requests[1]!.previousScene === result!.versions[0]!.drawingScene,
      reviews,
      polygonPoints.length,
      result!.versions.length,
      result!.attempts.used,
      result!.attempts.selected,
      result!.attempts.stopped,
    ],
    expected: [['create', 'create'], true, undefined, true, 2, 16, 2, 2, 2, 'passed'],
  })
})

test('Mixed typography corrections reuse artwork and keep the full original request in final review', async () => {
  const artwork = await solid('#204060')
  const originalPrompt = 'Make an ocean card with the exact heading ATLAS.'
  const mixed: MixedImagePlan = {
    artworkPrompt: 'Paint an ocean scene. Reserve the top quarter for an overlay; render no new text or logos.',
    drawingPrompt: 'Overlay the exact word ATLAS, centered at x=64 with baseline y=30.',
    artworkScope: 'objects',
    regenerateArtwork: true,
    reason: 'Paint the ocean and draw its exact heading separately.',
  }
  const renders: ImageRenderRequest[] = []
  const drawings: DrawingRequest[] = []
  const planning: Array<Parameters<ImageWorkflowDependencies['planMixedImage']>[0]> = []
  const reviewPrompts: string[] = []
  const [result] = await runImageWorkflow(
    {
      prompt: originalPrompt,
      selection: selection('mixed'),
      refs: [],
      size: '128x96',
      count: 1,
      maxAttempts: 3,
    },
    {
      ...noPaidCalls,
      planMixedImage: async (request) => {
        planning.push(request)
        return { ...mixed, regenerateArtwork: !request.previousPlan }
      },
      renderImages: async (request) => {
        renders.push(request)
        return [{ data: artwork, generated: artwork, generationPrompt: request.prompt }]
      },
      planDrawing: async (request) => {
        drawings.push(request)
        return drawingScene([
          {
            type: 'text',
            x: 64,
            y: 30,
            text: drawings.length === 1 ? 'ALTAS' : 'ATLAS',
            fontFamily: 'sans-serif',
            fontSize: 16,
            fontWeight: 'bold',
            anchor: 'middle',
            letterSpacing: 0,
            rotation: 0,
            style: solidStyle,
          },
        ])
      },
      assessImage: async (request) => {
        reviewPrompts.push(request.prompt)
        return reviewPrompts.length === 1
          ? correction('Correct the heading from ALTAS to ATLAS.')
          : { ...passedReview, comparison: 'better' }
      },
    },
  )
  assert({
    given: 'painted artwork is approved but its precise heading needs correction',
    should: 'reuse the same raster, redo only the overlay and review the complete original request',
    actual: [
      renders.length,
      renders[0]!.prompt,
      renders[0]!.feedback,
      planning.length,
      planning[1]!.previousPlan === result!.versions[0]!.mixedPlan,
      planning[1]!.refs[0]!.data === artwork,
      drawings.map((request) => request.mode),
      drawings.every((request) => request.refs?.[0]?.data === artwork),
      drawings[1]!.prompt,
      drawings[1]!.feedback?.includes('ALTAS to ATLAS'),
      reviewPrompts,
      result!.artwork === artwork,
      result!.svg?.includes('ATLAS'),
      result!.attempts.used,
      result!.attempts.selected,
    ],
    expected: [
      1,
      mixed.artworkPrompt,
      undefined,
      2,
      true,
      true,
      ['overlay', 'overlay'],
      true,
      mixed.drawingPrompt,
      true,
      [originalPrompt, originalPrompt],
      true,
      true,
      2,
      2,
    ],
  })
})

test('Localized mixed artwork uses the refined working footprint without sending overlay requirements to image generation', async () => {
  const original = await protectedGraphic()
  const plan = {
    ...original.plan!,
    changes: 'Replace the central artwork and add the exact heading ATLAS.',
    requirements: ['Add the exact heading ATLAS.', 'Keep the protected inset and surrounding artwork.'],
    editRegions: [testRegion(350, 350, 650, 650)],
  }
  const edit = { ...original, plan, mask: await maskFromPlan(plan, original.canvas) }
  const artwork = await solid('#8040a0')
  const mixed: MixedImagePlan = {
    artworkPrompt:
      'Paint a purple textured tile inside the permitted workspace. Reserve space for an overlay; render no new text.',
    drawingPrompt: 'Add the exact heading ATLAS along the upper edge.',
    artworkScope: 'objects',
    regenerateArtwork: true,
    reason: 'Keep artwork and precise lettering separate.',
  }
  const renders: ImageRenderRequest[] = []
  const refinements: Array<Parameters<ImageWorkflowDependencies['refineImageMask']>[0]> = []
  let reviewInput: Parameters<ImageWorkflowDependencies['finishImageEdit']>[0] | undefined
  const [result] = await runImageWorkflow(
    {
      prompt: 'Replace the central artwork and add the exact heading ATLAS.',
      selection: selection('mixed', 'preserve_image'),
      refs: [edit.canvas],
      edit,
      size: '128x96',
      count: 1,
      maxAttempts: 1,
    },
    {
      ...noPaidCalls,
      planMixedImage: async () => mixed,
      renderImages: async (request) => {
        renders.push(request)
        return [{ data: artwork, generated: artwork, generationPrompt: request.prompt }]
      },
      refineImageMask: async (request) => {
        refinements.push(request)
        return request.edit.generationMask!
      },
      planDrawing: async () =>
        drawingScene([
          {
            type: 'text',
            x: 64,
            y: 30,
            text: 'ATLAS',
            fontFamily: 'sans-serif',
            fontSize: 10,
            fontWeight: 'bold',
            anchor: 'middle',
            letterSpacing: 0,
            rotation: 0,
            style: solidStyle,
          },
        ]),
      finishImageEdit: async (request) => {
        reviewInput = request
        return finishImageEdit(request, async () => passedReview)
      },
    },
  )
  const pixels = await sharp(result!.data).ensureAlpha().raw().toBuffer()
  const at = (24 * 128 + 24) * 4
  assert({
    given: 'the generated artwork extends beyond the initial footprint but stays inside the permitted workspace',
    should:
      'retain its observed extent, preserve protected pixels and keep exact overlay text out of artwork generation',
    actual: [
      renders[0]!.prompt,
      renders[0]!.feedback,
      JSON.stringify(renders[0]!.edit?.plan ?? {}).includes('ATLAS'),
      refinements.length,
      refinements[0]?.prompt,
      refinements[0]?.edit.canvas === edit.canvas,
      [...pixels.subarray(at, at + 4)],
      await changedProtectedPixels(result!.data, edit),
      result!.svg?.includes('ATLAS'),
      reviewInput?.rawArtwork === artwork,
      Buffer.from(reviewInput!.rawArtwork!).equals(Buffer.from(result!.artwork!)),
      reviewInput?.generated === result!.generated,
      Buffer.from(reviewInput!.generated).equals(Buffer.from(reviewInput!.rawArtwork!)),
    ],
    expected: [
      mixed.artworkPrompt,
      undefined,
      false,
      1,
      mixed.artworkPrompt,
      true,
      [128, 64, 160, 255],
      0,
      true,
      true,
      false,
      true,
      false,
    ],
  })
})

test('New drawings and transformations use references for style without embedding them as the base', async () => {
  const reference: ImageReference = {
    name: 'palette.png',
    mediaType: 'image/png',
    data: await solid('#204060', 64, 32),
  }
  const captured: Array<{
    intent: string
    mode: string
    width: number
    height: number
    styleReference: boolean
    embedded: boolean
    cornerAlpha: number
  }> = []
  for (const intent of ['create', 'transform'] as const) {
    let planned: DrawingRequest | undefined
    const [result] = await runImageWorkflow(
      {
        prompt: 'Create a new star graphic using the reference colors.',
        selection: { ...selection('drawing', intent), layout: 'square' },
        refs: [reference],
        count: 1,
        maxAttempts: 1,
      },
      {
        ...noPaidCalls,
        planDrawing: async (request) => {
          planned = request
          return { ...drawingScene([drawingStar()]), width: request.width, height: request.height }
        },
        assessImage: async () => passedReview,
      },
    )
    const alpha = await sharp(result!.data).extractChannel('alpha').raw().toBuffer()
    captured.push({
      intent,
      mode: planned!.mode,
      width: planned!.width,
      height: planned!.height,
      styleReference: planned!.refs?.[0] === reference,
      embedded: result!.svg!.includes('data:image/png;base64,'),
      cornerAlpha: alpha[0]!,
    })
  }
  assert({
    given: 'a creation or creative transformation is informed by a small wide style reference',
    should: 'use the requested layout and fresh transparent drawing surface while retaining reference context',
    actual: captured,
    expected: ['create', 'transform'].map((intent) => ({
      intent,
      mode: 'create',
      width: 1024,
      height: 1024,
      styleReference: true,
      embedded: false,
      cornerAlpha: 0,
    })),
  })
})

test('A drawing edit planner sees the actual padded canvas used by the renderer and preservation mask', async () => {
  const original: ImageReference = { name: 'wide.png', mediaType: 'image/png', data: await solid('#204060', 128, 64) }
  const canvas = await imageCanvas(original, '128x128')
  const regions = [testRegion(125, 250, 875, 750)]
  const plan = { ...testMaskPlan(regions), generationRegions: regions, edges: 'hard' as const }
  const mask = await maskFromPlan(plan, canvas)
  const edit: MaskedImageEdit = {
    canvas,
    mask,
    generationMask: mask,
    plan,
    description: plan.changes,
    complexity: 'complex',
  }
  let planned: DrawingRequest | undefined
  const [result] = await runImageWorkflow(
    {
      prompt: 'Add a small star in the center of the original strip.',
      selection: selection('drawing', 'preserve_image'),
      refs: [original],
      edit,
      size: '128x128',
      count: 1,
      maxAttempts: 1,
    },
    {
      ...noPaidCalls,
      planDrawing: async (request) => {
        planned = request
        return { ...drawingScene([drawingStar({ cy: 64, outerRadius: 20, innerRadius: 9 })]), height: 128 }
      },
      finishImageEdit: async (request) => finishImageEdit(request, async () => passedReview),
    },
  )
  const preview = planned!.refs![0]!
  const metadata = await sharp(preview.data).metadata()
  const alpha = await sharp(preview.data).extractChannel('alpha').raw().toBuffer()
  assert({
    given: 'a wide original is fitted with transparent padding onto an explicitly square canvas',
    should: 'show planning the exact canvas so pixel positions align with the rendered base and masks',
    actual: [
      planned!.mode,
      planned!.width,
      planned!.height,
      preview.data === canvas.data,
      metadata.width,
      metadata.height,
      alpha[0],
      alpha[64 * 128 + 64],
      await changedProtectedPixels(result!.data, edit),
    ],
    expected: ['edit', 128, 128, true, 128, 128, 0, 255, 0],
  })
})

test('A mixed whole-image edit normalizes unsupported reference dimensions before calling the image API', async () => {
  const reference: ImageReference = {
    name: 'small-graphic.png',
    mediaType: 'image/png',
    data: await solid('#204060', 700, 500),
  }
  let size: string | undefined
  const [result] = await runImageWorkflow(
    {
      prompt: 'Repaint the full illustration and add an exact heading.',
      selection: selection('mixed', 'other_edit'),
      refs: [reference],
      count: 1,
      maxAttempts: 1,
    },
    {
      ...noPaidCalls,
      planMixedImage: async () => ({
        artworkPrompt: 'Repaint the full scene without text.',
        drawingPrompt: 'Add the title ATLAS.',
        artworkScope: 'objects',
        regenerateArtwork: true,
        reason: 'Separate painted artwork and precise heading.',
      }),
      renderImages: async (request) => {
        size = request.size
        const [width, height] = size!.split('x').map(Number)
        const data = await solid('#8040a0', width, height)
        return [{ data, generated: data, generationPrompt: request.prompt }]
      },
      planDrawing: async (request) => ({
        ...drawingScene([drawingStar()]),
        width: request.width,
        height: request.height,
      }),
      assessImage: async () => passedReview,
    },
  )
  assert({
    given: 'an automatic mixed edit starts from a 700 by 500 graphic below the image API limits',
    should: 'choose supported artwork dimensions and use that same canvas for the overlay',
    actual: [
      validateSize(size!),
      size !== '700x500',
      `${result!.drawingScene!.width}x${result!.drawingScene!.height}` === size,
      result!.attempts.stopped,
    ],
    expected: [null, true, true, 'passed'],
  })
})

test('Mixed surface repainting keeps the full prepared panel instead of narrowing to foreground contours', async () => {
  const original = await protectedGraphic()
  const plan = {
    ...original.plan!,
    changes: 'Repaint the whole center panel including its empty background.',
    editRegions: [testRegion(350, 350, 650, 650)],
  }
  const panelMask = await maskFromPlan(plan, original.canvas)
  const automatic: MaskedImageEdit = { ...original, plan, mask: panelMask }
  const explicit: MaskedImageEdit = { ...automatic, plan: undefined, generationMask: panelMask }
  const artwork = await solid('#8040a0')
  let refinements = 0
  const results: Array<{ fullPanel: boolean; outsideFixed: boolean; protectedDamage: number; maskFixed: boolean }> = []
  const before = await sharp(original.canvas.data).ensureAlpha().raw().toBuffer()
  for (const edit of [automatic, explicit]) {
    const [result] = await runImageWorkflow(
      {
        prompt: 'Repaint the entire central illustration panel and add a small marker.',
        selection: selection('mixed', 'preserve_image'),
        refs: [edit.canvas],
        edit,
        size: '128x96',
        count: 1,
        maxAttempts: 1,
      },
      {
        ...noPaidCalls,
        planMixedImage: async () => ({
          artworkPrompt: 'Repaint the whole panel as one coherent surface, including background and negative space.',
          drawingPrompt: 'Add a small marker within the panel.',
          artworkScope: 'surface',
          regenerateArtwork: true,
          reason: 'Preserve the complete panel as a visual unit.',
        }),
        renderImages: async (request) => [{ data: artwork, generated: artwork, generationPrompt: request.prompt }],
        refineImageMask: async () => {
          refinements++
          throw new Error('Surface artwork must not narrow to foreground contours.')
        },
        planDrawing: async () =>
          drawingScene([{ type: 'rect', x: 76, y: 38, width: 3, height: 3, radius: 0, style: solidStyle }]),
        finishImageEdit: async (request) => finishImageEdit(request, async () => passedReview),
      },
    )
    const pixels = await sharp(result!.data).ensureAlpha().raw().toBuffer()
    const at = (x: number, y: number) => (y * 128 + x) * 4
    const panelColor = Buffer.from([128, 64, 160, 255])
    results.push({
      fullPanel: [at(48, 36), at(48, 60)].every((offset) => pixels.subarray(offset, offset + 4).equals(panelColor)),
      outsideFixed: pixels.subarray(at(24, 24), at(24, 24) + 4).equals(before.subarray(at(24, 24), at(24, 24) + 4)),
      protectedDamage: await changedProtectedPixels(result!.data, edit),
      maskFixed: result!.artworkMask === edit.mask,
    })
  }
  assert({
    given: 'a coherent surface repaint with either an automatic panel boundary or an explicit user mask',
    should: 'retain all panel pixels, leave the surrounding design fixed and skip foreground refinement',
    actual: [refinements, results],
    expected: [
      0,
      Array.from({ length: 2 }, () => ({ fullPanel: true, outsideFixed: true, protectedDamage: 0, maskFixed: true })),
    ],
  })
})
