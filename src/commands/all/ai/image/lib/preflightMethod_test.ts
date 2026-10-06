import { assert, test } from '#test'
import { selectImageSettings } from './preflight.ts'
import type { ImageDecision, ImageSelectionRequest } from './preflight.ts'

const graphic: ImageDecision = {
  layout: 'landscape',
  intent: 'preserve_image',
  complexity: 'complex',
  model: 'flare',
  quality: 'medium',
  reason: 'The diagram needs precise labels and geometry.',
}
const request: ImageSelectionRequest = {
  prompt: 'Replace the middle diagram label with READY.',
  refs: [new Uint8Array([1])],
  count: 1,
}

test('Default and legacy auto requests use image generation even when a stale selector recommends SVG', async () => {
  const observed: Array<[string, string, string, string]> = []
  for (const method of [undefined, 'auto', 'image'] as const) {
    for (const staleMethod of ['drawing', 'mixed'] as const) {
      let suppliedMethod = ''
      const selected = await selectImageSettings({ ...request, method }, async (input) => {
        suppliedMethod = input.method ?? ''
        return { ...graphic, method: staleMethod }
      })
      observed.push([selected.method, suppliedMethod, selected.layout, selected.quality])
    }
  }
  assert({
    given: 'precise graphics whose caller has not requested vector drawing or overlays',
    should: 'enforce OpenAI image generation while retaining automatic layout and quality settings',
    actual: observed,
    expected: Array.from({ length: 6 }, () => ['image', 'image', 'landscape', 'medium']),
  })
})

test('An explicit image model implies raster production unless the production method is also explicit', async () => {
  const image = await selectImageSettings({ ...request, model: 'sunburst' }, async () => graphic)
  const drawing = await selectImageSettings({ ...request, model: 'sunburst', method: 'drawing' }, async () => graphic)
  const mixed = await selectImageSettings({ ...request, model: 'flare', method: 'mixed' }, async () => graphic)
  assert({
    given: 'a user-selected image model with optional deliberate method choices',
    should: 'honor the selected production method and rendering model independently',
    actual: [
      [image.method, image.model],
      [drawing.method, drawing.model],
      [mixed.method, mixed.model],
    ],
    expected: [
      ['image', 'gpt-image-2.5-sunburst'],
      ['drawing', 'gpt-image-2.5-sunburst'],
      ['mixed', 'gpt-image-2.5-flare'],
    ],
  })
})

test('Explicit drawing or mixed production still runs layout selection when model and quality are set', async () => {
  let calls = 0
  const methods = [] as string[]
  for (const method of ['drawing', 'mixed'] as const) {
    const selected = await selectImageSettings(
      { ...request, refs: [], method, model: 'flare', quality: 'low' },
      async () => {
        calls++
        return graphic
      },
    )
    methods.push(`${selected.method}/${selected.layout}/${selected.intent}`)
  }
  assert({
    given: 'an explicitly drawn or mixed creation with otherwise complete raster settings',
    should: 'classify layout while normalizing reference-free intent to creation',
    actual: [calls, methods],
    expected: [2, ['drawing/landscape/create', 'mixed/landscape/create']],
  })
})

test('Photographic preservation retains its quality rule while graphic drawing stays inexpensive', async () => {
  const photo = await selectImageSettings(request, async () => ({
    ...graphic,
    intent: 'preserve_photo',
  }))
  const vector = await selectImageSettings({ ...request, method: 'drawing' }, async () => graphic)
  const restyle = await selectImageSettings(request, async () => ({ ...graphic, intent: 'transform' }))
  assert({
    given: 'a fidelity-preserving photo edit, a vector graphic edit and a creative transformation',
    should: 'promote only the photographic preservation request to Sunburst/max',
    actual: [
      [photo.method, photo.model, photo.quality],
      [vector.method, vector.model, vector.quality],
      [restyle.method, restyle.model, restyle.quality],
    ],
    expected: [
      ['image', 'gpt-image-2.5-sunburst', 'max'],
      ['drawing', 'gpt-image-2.5-flare', 'medium'],
      ['image', 'gpt-image-2.5-flare', 'medium'],
    ],
  })
})

test('Explicit raster settings without references have a deterministic square fallback and skip paid selection', async () => {
  const selected = await selectImageSettings(
    { ...request, refs: [], method: 'auto', model: 'flare', quality: 'low' },
    async () => {
      throw new Error('No selector call expected')
    },
  )
  assert({
    given: 'an explicit raster creation without layout classification',
    should: 'use the documented fallback without inventing a preservation intent',
    actual: [selected.method, selected.layout, selected.intent, selected.complexity],
    expected: ['image', 'square', 'create', 'simple'],
  })
})
