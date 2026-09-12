import sharp from 'sharp'
import type {
  EvaluationColorTarget,
  EvaluationTargetMetrics,
  ImageEvaluationFixture,
  ImageEvaluationMetrics,
} from './types.ts'

async function rgba(data: Uint8Array) {
  return sharp(data).toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true })
}

async function alphaMask(data: Uint8Array, width: number, height: number): Promise<Uint8Array> {
  const result = await sharp(data).ensureAlpha().extractChannel('alpha').raw().toBuffer({ resolveWithObject: true })
  if (result.info.width !== width || result.info.height !== height)
    throw new Error('Evaluation masks must match the source canvas dimensions.')
  return result.data
}

function transparencyCount(data: Uint8Array): number {
  let count = 0
  for (let offset = 3; offset < data.length; offset += 4) if (data[offset] === 0) count++
  return count
}

async function measureTarget(
  target: EvaluationColorTarget,
  output: Uint8Array,
  width: number,
): Promise<EvaluationTargetMetrics> {
  const height = output.length / width / 4
  const expected = await alphaMask(target.mask, width, height)
  let expectedPixels = 0
  let actualPixels = 0
  let intersection = 0
  let expectedX = 0
  let expectedY = 0
  let actualX = 0
  let actualY = 0
  let left = Number.POSITIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  let right = -1
  let bottom = -1
  const bounds = target.bounds
  if (
    !Object.values(bounds).every(Number.isInteger) ||
    bounds.left < 0 ||
    bounds.top < 0 ||
    bounds.width <= 0 ||
    bounds.height <= 0 ||
    bounds.left + bounds.width > width ||
    bounds.top + bounds.height > height
  )
    throw new Error('Evaluation target bounds must lie inside the source canvas.')
  for (let y = bounds.top; y < bounds.top + bounds.height; y++) {
    for (let x = bounds.left; x < bounds.left + bounds.width; x++) {
      const pixel = y * width + x
      const offset = pixel * 4
      const wanted = expected[pixel] >= 128
      let distance = 0
      for (let channel = 0; channel < 3; channel++) distance += (output[offset + channel] - target.color[channel]) ** 2
      const present = output[offset + 3] >= 128 && distance <= target.tolerance ** 2
      if (wanted) {
        expectedPixels++
        expectedX += x
        expectedY += y
      }
      if (present) {
        actualPixels++
        actualX += x
        actualY += y
        left = Math.min(left, x)
        top = Math.min(top, y)
        right = Math.max(right, x)
        bottom = Math.max(bottom, y)
      }
      if (wanted && present) intersection++
    }
  }
  const union = actualPixels + expectedPixels - intersection
  const intersectionOverUnion = union ? intersection / union : 0
  const centerError =
    actualPixels && expectedPixels
      ? Math.hypot(
          actualX / actualPixels - expectedX / expectedPixels,
          actualY / actualPixels - expectedY / expectedPixels,
        )
      : null
  return {
    name: target.name,
    expectedPixels,
    actualPixels,
    intersectionOverUnion,
    precision: actualPixels ? intersection / actualPixels : 0,
    recall: expectedPixels ? intersection / expectedPixels : 0,
    centerError,
    actualBounds: actualPixels ? { left, top, width: right - left + 1, height: bottom - top + 1 } : null,
    passed:
      expectedPixels > 0 &&
      intersectionOverUnion >= target.minimumIntersectionOverUnion &&
      centerError !== null &&
      centerError <= target.maximumCenterError,
  }
}

export async function measureImageEvaluation(
  fixture: ImageEvaluationFixture,
  data: Uint8Array,
): Promise<ImageEvaluationMetrics> {
  const output = await rgba(data)
  const dimensions: ImageEvaluationMetrics['dimensions'] = {
    expected: [fixture.width, fixture.height],
    actual: [output.info.width, output.info.height],
    passed: output.info.width === fixture.width && output.info.height === fixture.height,
  }
  if (!dimensions.passed) {
    return {
      dimensions,
      preservation: null,
      transparency: null,
      targets: [],
      transparentTargets: [],
      objectivePassed: false,
      visualRequirements: fixture.definition.visualRequirements,
    }
  }
  const [source, protectedAlpha] = await Promise.all([
    rgba(fixture.source),
    alphaMask(fixture.protectedMask, fixture.width, fixture.height),
  ])
  if (source.info.width !== fixture.width || source.info.height !== fixture.height)
    throw new Error('Evaluation source dimensions do not match the fixture.')
  let protectedPixels = 0
  let changedPixels = 0
  let maximumChannelDifference = 0
  let protectedTransparentPixels = 0
  let changedProtectedAlphaPixels = 0
  for (let pixel = 0; pixel < protectedAlpha.length; pixel++) {
    if (protectedAlpha[pixel] !== 255) continue
    const offset = pixel * 4
    protectedPixels++
    if (source.data[offset + 3] === 0) protectedTransparentPixels++
    if (source.data[offset + 3] !== output.data[offset + 3]) changedProtectedAlphaPixels++
    let changed = false
    for (let channel = 0; channel < 4; channel++) {
      const difference = Math.abs(source.data[offset + channel] - output.data[offset + channel])
      maximumChannelDifference = Math.max(maximumChannelDifference, difference)
      if (difference > 0) changed = true
    }
    if (changed) changedPixels++
  }
  const targets = await Promise.all(fixture.targets.map((target) => measureTarget(target, output.data, fixture.width)))
  const transparentTargets = await Promise.all(
    (fixture.transparentTargets ?? []).map(async (target) => {
      const alpha = await alphaMask(target.mask, fixture.width, fixture.height)
      let pixels = 0
      let nontransparentPixels = 0
      for (let pixel = 0; pixel < alpha.length; pixel++) {
        if (alpha[pixel] < 128) continue
        pixels++
        if (output.data[pixel * 4 + 3] !== 0) nontransparentPixels++
      }
      return { name: target.name, pixels, nontransparentPixels, passed: pixels > 0 && nontransparentPixels === 0 }
    }),
  )
  const preservation = {
    protectedPixels,
    changedPixels,
    maximumChannelDifference,
    passed: protectedPixels > 0 && changedPixels === 0,
  }
  const transparency = {
    protectedTransparentPixels,
    changedProtectedAlphaPixels,
    sourceTransparentPixels: transparencyCount(source.data),
    outputTransparentPixels: transparencyCount(output.data),
    passed: changedProtectedAlphaPixels === 0,
  }
  return {
    dimensions,
    preservation,
    transparency,
    targets,
    transparentTargets,
    objectivePassed:
      preservation.passed &&
      transparency.passed &&
      targets.every((target) => target.passed) &&
      transparentTargets.every((target) => target.passed),
    visualRequirements: fixture.definition.visualRequirements,
  }
}
