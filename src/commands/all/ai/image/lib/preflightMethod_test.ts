import { assert, test } from '#test'
import { selectImageSettings } from './preflight.ts'
import type { ImageDecision, ImageSelectionRequest } from './preflight.ts'

const graphic: ImageDecision = {
  method: 'drawing',
  layout: 'landscape',
  intent: 'preserve_image',
  complexity: 'complex',
  model: 'flare',
  quality: 'medium',
  reason: 'The exact diagram can be drawn as vector geometry.',
}
const request: ImageSelectionRequest = {
  prompt: 'Replace the middle diagram label with READY.',
  refs: [new Uint8Array([1])],
  count: 1,
}

test('Automatic selection routes precise graphics and mixed artwork independently of raster quality', async () => {
  const drawing = await selectImageSettings(request, async () => graphic)
  const mixed = await selectImageSettings(request, async () => ({
    ...graphic,
    method: 'mixed',
    quality: 'high',
    layout: 'portrait',
  }))
  assert({
    given: 'an exact diagram and an illustrated poster',
    should: 'retain their different methods, canvas layouts and selected rendering quality',
    actual: [
      [drawing.method, drawing.layout, drawing.quality],
      [mixed.method, mixed.layout, mixed.quality],
    ],
    expected: [
      ['drawing', 'landscape', 'medium'],
      ['mixed', 'portrait', 'high'],
    ],
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
    method: 'image',
    intent: 'preserve_photo',
  }))
  const vector = await selectImageSettings(request, async () => graphic)
  const restyle = await selectImageSettings(request, async () => ({ ...graphic, method: 'image', intent: 'transform' }))
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
  const selected = await selectImageSettings({ ...request, refs: [], model: 'flare', quality: 'low' }, async () => {
    throw new Error('No selector call expected')
  })
  assert({
    given: 'an explicit raster creation without layout classification',
    should: 'use the documented fallback without inventing a preservation intent',
    actual: [selected.method, selected.layout, selected.intent, selected.complexity],
    expected: ['image', 'square', 'create', 'simple'],
  })
})
