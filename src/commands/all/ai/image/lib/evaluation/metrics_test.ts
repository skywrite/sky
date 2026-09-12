import sharp from 'sharp'
import { assert, test } from '#test'
import { createImageEvaluationFixture, imageEvaluationCases } from './fixtures.ts'
import { measureImageEvaluation } from './metrics.ts'

test('Synthetic calibration examples satisfy objective requirements while unedited sources cannot pass as successful edits', async () => {
  const results: {
    id: string
    examplePasses: boolean
    unchangedPreserved: boolean | undefined
    unchangedPasses: boolean
    requiresVisualAssessment: boolean
  }[] = []
  for (const definition of imageEvaluationCases) {
    const fixture = await createImageEvaluationFixture(definition.id)
    const [example, unchanged] = await Promise.all([
      measureImageEvaluation(fixture, fixture.example),
      measureImageEvaluation(fixture, fixture.source),
    ])
    results.push({
      id: definition.id,
      examplePasses: example.objectivePassed,
      unchangedPreserved: unchanged.preservation?.passed,
      unchangedPasses: unchanged.objectivePassed,
      requiresVisualAssessment: example.visualRequirements.length > 0,
    })
  }
  assert({
    given: 'fixed examples spanning shaded imagery, geometry, lettering, transparency and mixed artwork',
    should: 'separate successful preservation from evidence that the requested edit happened',
    actual: results,
    expected: imageEvaluationCases.map(({ id }) => ({
      id,
      examplePasses: true,
      unchangedPreserved: true,
      unchangedPasses: false,
      requiresVisualAssessment: true,
    })),
  })
})

test('Fixtures are reproducible and do not depend on external image files', async () => {
  const [first, second] = await Promise.all([
    createImageEvaluationFixture('mixed-poster'),
    createImageEvaluationFixture('mixed-poster'),
  ])
  assert({
    given: 'the same procedural case created twice',
    should: 'retain identical source, calibration image and protected regions',
    actual: [
      Buffer.from(first.source).equals(Buffer.from(second.source)),
      Buffer.from(first.example).equals(Buffer.from(second.example)),
      Buffer.from(first.protectedMask).equals(Buffer.from(second.protectedMask)),
    ],
    expected: [true, true, true],
  })
})

test('A single altered protected color or alpha value is measured even when the replacement is correct', async () => {
  const fixture = await createImageEvaluationFixture('transparent-cutout')
  const pixels = await sharp(fixture.example).ensureAlpha().raw().toBuffer()
  pixels[0] = 1
  pixels[7] = 1
  const changed = await sharp(pixels, { raw: { width: fixture.width, height: fixture.height, channels: 4 } })
    .png()
    .toBuffer()
  const metrics = await measureImageEvaluation(fixture, changed)
  assert({
    given: 'a correct cutout whose invisible red channel and a separate alpha pixel were modified outside the edit',
    should: 'catch both RGBA violations without conflating them with replacement accuracy',
    actual: [
      metrics.preservation?.changedPixels,
      metrics.preservation?.maximumChannelDifference,
      metrics.transparency?.changedProtectedAlphaPixels,
      metrics.targets[0].passed,
      metrics.objectivePassed,
    ],
    expected: [2, 1, 1, true, false],
  })
})

test('A correctly colored replacement in the wrong position fails geometry while preservation still passes', async () => {
  const fixture = await createImageEvaluationFixture('expanded-star')
  const bounds = fixture.targets[0].bounds
  const moved = await sharp(fixture.example)
    .extract({ left: bounds.left, top: bounds.top, width: bounds.width - 20, height: bounds.height })
    .extend({ left: 20, right: 0, top: 0, bottom: 0, background: 'white' })
    .png()
    .toBuffer()
  const output = await sharp(fixture.example)
    .composite([{ input: moved, left: bounds.left, top: bounds.top }])
    .png()
    .toBuffer()
  const metrics = await measureImageEvaluation(fixture, output)
  assert({
    given: 'an eight-point star shifted twenty pixels to the right inside the permitted region',
    should: 'detect placement error without marking untouched content as damaged',
    actual: [
      metrics.preservation?.passed,
      Math.round(metrics.targets[0].centerError!),
      metrics.targets[0].passed,
      metrics.objectivePassed,
    ],
    expected: [true, 20, false, false],
  })
})

test('A retained solid backdrop cannot pass a transparency edit merely by preserving the foreground shape', async () => {
  const fixture = await createImageEvaluationFixture('transparent-cutout')
  const metrics = await measureImageEvaluation(fixture, fixture.source)
  assert({
    given: 'the original ring and blue background',
    should: 'pass the ring footprint and fail actual removal of the background',
    actual: [
      metrics.targets[0].passed,
      metrics.transparentTargets[0].nontransparentPixels > 1000,
      metrics.transparentTargets[0].passed,
      metrics.objectivePassed,
    ],
    expected: [true, true, false, false],
  })
})

test('A mixed design must satisfy both the generated artwork and precise graphic changes', async () => {
  const fixture = await createImageEvaluationFixture('mixed-poster')
  const bounds = fixture.targets[0].bounds
  const badge = await sharp(fixture.example).extract(bounds).png().toBuffer()
  const onlyBadge = await sharp(fixture.source)
    .composite([{ input: badge, left: bounds.left, top: bounds.top }])
    .png()
    .toBuffer()
  const metrics = await measureImageEvaluation(fixture, onlyBadge)
  assert({
    given: 'the correct ticket graphic pasted onto the unchanged green artwork',
    should: 'measure the successful precise geometry and the missing artwork change separately',
    actual: [
      metrics.preservation?.passed,
      metrics.targets[0].passed,
      metrics.targets[1].passed,
      metrics.objectivePassed,
    ],
    expected: [true, true, false, false],
  })
})

test('Mismatched dimensions fail without resampling into apparently matching protected pixels', async () => {
  const fixture = await createImageEvaluationFixture('expanded-star')
  const resized = await sharp(fixture.example).resize(512, 512).png().toBuffer()
  const metrics = await measureImageEvaluation(fixture, resized)
  assert({
    given: 'a visually similar image with the wrong canvas dimensions',
    should: 'report the dimensions and leave invalid comparisons unmeasured',
    actual: [
      metrics.dimensions.actual,
      metrics.dimensions.passed,
      metrics.preservation,
      metrics.targets.length,
      metrics.objectivePassed,
    ],
    expected: [[512, 512], false, null, 0, false],
  })
})

test('A broken preservation fixture is rejected rather than yielding a vacuous pixel-preservation pass', async () => {
  const fixture = await createImageEvaluationFixture('expanded-star')
  const invalidMask = await sharp(fixture.protectedMask).resize(16, 16).png().toBuffer()
  let message = ''
  try {
    await measureImageEvaluation({ ...fixture, protectedMask: invalidMask }, fixture.example)
  } catch (error) {
    message = (error as Error).message
  }
  assert({
    given: 'an incorrectly sized fixture mask',
    should: 'refuse a misleading preservation measurement',
    actual: message,
    expected: 'Evaluation masks must match the source canvas dimensions.',
  })
})
