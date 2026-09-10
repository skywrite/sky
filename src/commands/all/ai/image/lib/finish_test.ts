import sharp from 'sharp'
import { assert, test } from '#test'
import { finishImageEdit } from './finish.ts'
import { passedReview, testMaskPlan, testRegion } from './imageEditTestHelpers.ts'
import { maskFromPlan } from './mask.ts'
import type { MaskedImageEdit } from './mask.ts'
import type { ImageEditAssessment } from './review.ts'

async function fixture() {
  const raw = Buffer.alloc(128 * 128 * 4)
  for (let i = 0; i < raw.length; i += 4) {
    raw[i] = (i * 17) % 256
    raw[i + 1] = (i * 31) % 256
    raw[i + 2] = 180
    raw[i + 3] = i % 28 === 0 ? 0 : 255
  }
  const canvas = {
    name: 'graphic.png',
    mediaType: 'image/png' as const,
    data: await sharp(raw, { raw: { width: 128, height: 128, channels: 4 } })
      .png()
      .toBuffer(),
  }
  const plan = {
    ...testMaskPlan([testRegion(300, 300, 700, 700)], [testRegion(450, 450, 550, 550)]),
    edges: 'hard' as const,
  }
  const mask = await maskFromPlan(plan, canvas)
  const generationMask = await maskFromPlan({ ...plan, editRegions: plan.generationRegions }, canvas)
  const generated = await sharp({ create: { width: 128, height: 128, channels: 4, background: '#ff0000' } })
    .png()
    .toBuffer()
  const edit: MaskedImageEdit = { canvas, mask, generationMask, plan, description: plan.changes, complexity: 'complex' }
  return {
    prompt: 'Replace the center tile with a larger red tile; retain its inset and surrounding graphic.',
    generated,
    edit,
  }
}

const revision: ImageEditAssessment = {
  ...passedReview,
  verdict: 'revise_mask',
  reason: 'The composite clipped the larger replacement.',
  // Deliberately overbroad: the finisher must enforce the planned workspace and protected hole.
  editRegions: [testRegion(0, 0, 1000, 1000)],
}

test('Reviewed mask corrections reveal the new silhouette without changing protected pixels or transparency', async () => {
  const request = await fixture()
  const rounds: boolean[] = []
  const result = await finishImageEdit(request, async (input) => {
    rounds.push(input.allowMaskRevision)
    return rounds.length === 1 ? revision : passedReview
  })
  const source = await sharp(request.edit.canvas.data).ensureAlpha().raw().toBuffer()
  const output = await sharp(result.data).ensureAlpha().raw().toBuffer()
  const limit = await sharp(request.edit.generationMask!.data).extractChannel('alpha').raw().toBuffer()
  let protectedPixels = 0
  let changedProtected = 0
  for (let i = 0; i < limit.length; i++)
    if (limit[i] === 255) {
      protectedPixels++
      if (!source.subarray(i * 4, i * 4 + 4).equals(output.subarray(i * 4, i * 4 + 4))) changedProtected++
    }
  const expanded = (25 * 128 + 25) * 4
  assert({
    given: 'a good raw replacement clipped by the first blend and an overbroad suggested correction',
    should: 'reuse the raw pixels, check the corrected result, and keep every protected RGBA value exact',
    actual: [
      rounds,
      result.review.status,
      result.review.maskAdjusted,
      [...output.subarray(expanded, expanded + 4)],
      protectedPixels > 1000,
      changedProtected,
    ],
    expected: [[true, false], 'passed', true, [255, 0, 0, 255], true, 0],
  })
})

test('An explicit mask cannot be expanded by the visual reviewer', async () => {
  const request = await fixture()
  request.edit = { ...request.edit, plan: undefined, generationMask: request.edit.mask }
  let allowed = true
  const result = await finishImageEdit(request, async (input) => {
    allowed = input.allowMaskRevision
    return revision
  })
  assert({
    given: 'a supplied mask and a reviewer proposing a wider edit',
    should: 'retain the exact supplied mask and report that the result needs attention',
    actual: [
      allowed,
      result.review.status,
      result.review.maskAdjusted,
      Buffer.from(result.mask.data).equals(Buffer.from(request.edit.mask.data)),
    ],
    expected: [false, 'needs_revision', false, true],
  })
})

test('Unsuccessful reviews remain visible and automatic corrections are bounded', async () => {
  const request = await fixture()
  const statuses: string[] = []
  for (const assessment of [
    { ...passedReview, verdict: 'needs_revision' as const, reason: 'The replacement lacks its requested outline.' },
    { ...passedReview, checks: [{ requirement: 'Correct label', passed: false, detail: 'The label is misspelled.' }] },
    { ...revision, editRegions: [] },
  ]) {
    statuses.push((await finishImageEdit(request, async () => assessment)).review.status)
  }
  let calls = 0
  const repeated = await finishImageEdit(request, async () => {
    calls++
    return revision
  })
  assert({
    given: 'a missing feature, contradictory approval, invalid correction and repeated revision requests',
    should: 'never mark them passed or keep trying beyond one boundary correction',
    actual: [statuses, repeated.review.status, repeated.review.maskAdjusted, calls],
    expected: [['needs_revision', 'needs_revision', 'needs_revision'], 'needs_revision', true, 2],
  })
})

test('A review outage retains the protected result while cancellation still stops the request', async () => {
  const request = await fixture()
  const unavailable = await finishImageEdit(request, async () => {
    throw new Error('Mock review outage')
  })
  const source = await sharp(request.edit.canvas.data).ensureAlpha().raw().toBuffer()
  const result = await sharp(unavailable.data).ensureAlpha().raw().toBuffer()
  const controller = new AbortController()
  let cancelled = false
  try {
    await finishImageEdit({ ...request, signal: controller.signal }, async () => {
      controller.abort(new Error('Cancelled review'))
      return passedReview
    })
  } catch (error) {
    cancelled = (error as Error).message === 'Cancelled review'
  }
  assert({
    given: 'an unavailable reviewer after paid generation, and a user cancellation',
    should: 'retain the image with an honest review status and honor cancellation',
    actual: [unavailable.review.status, source.subarray(0, 4).equals(result.subarray(0, 4)), cancelled],
    expected: ['unavailable', true, true],
  })
})
