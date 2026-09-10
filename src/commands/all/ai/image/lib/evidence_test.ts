import { mkdtemp, readFile, rm } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import sharp from 'sharp'
import { assert, test } from '#test'
import { writeImageEvidence } from './evidence.ts'
import { passedReview, testMaskPlan } from './imageEditTestHelpers.ts'
import { maskFromPlan } from './mask.ts'

test('Edit evidence retains raw output, both masks, source and exact generation settings independently of the final preview', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'image-evidence-test-'))
  try {
    const source = await sharp({ create: { width: 128, height: 128, channels: 4, background: '#204080' } })
      .png()
      .toBuffer()
    const generated = await sharp({ create: { width: 128, height: 128, channels: 4, background: '#ff0000' } })
      .png()
      .toBuffer()
    const canvas = { name: 'graphic.png', mediaType: 'image/png' as const, data: source }
    const plan = testMaskPlan()
    const mask = await maskFromPlan(plan, canvas)
    const generationMask = await maskFromPlan({ ...plan, editRegions: plan.generationRegions }, canvas)
    const result = await writeImageEvidence(
      path.join(directory, 'atlas-graphic.png'),
      {
        data: source,
        generated,
        mask,
        generationPrompt: 'Exact rendering request.',
        background: 'transparent',
        review: { status: 'passed', reason: passedReview.reason, maskAdjusted: false, assessments: [passedReview] },
      },
      { canvas, mask, generationMask, plan, description: plan.changes },
      {
        prompt: 'Replace the center mark.',
        model: 'gpt-image-2.5-sunburst',
        quality: 'max',
        size: '128x128',
      },
    )
    const record = JSON.parse(await readFile(path.join(result.directory, 'review.json'), 'utf8'))
    assert({
      given: 'an edited graphic and the raw generation used for it',
      should: 'save reproducible evidence without replacing the final image or conflating the two masks',
      actual: [
        (await readFile(path.join(result.directory, 'generated.png'))).equals(generated),
        (await readFile(path.join(result.directory, 'source.png'))).equals(source),
        (await readFile(path.join(result.directory, 'generation-mask.png'))).equals(Buffer.from(generationMask.data)),
        (await readFile(result.mask)).equals(Buffer.from(mask.data)),
        record.settings.generationPrompt,
        record.settings.background,
        record.review.status,
        record.result,
      ],
      expected: [true, true, true, true, 'Exact rendering request.', 'transparent', 'passed', 'atlas-graphic.png'],
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
