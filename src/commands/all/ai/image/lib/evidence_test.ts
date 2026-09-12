import { mkdtemp, readFile, rm } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import sharp from 'sharp'
import { assert, test } from '#test'
import { renderDrawing } from './drawing/mod.ts'
import { drawingScene, drawingStar } from './drawing/testHelpers.ts'
import { writeImageEvidence } from './evidence.ts'
import { passedReview, testMaskPlan } from './imageEditTestHelpers.ts'
import { maskFromPlan } from './mask.ts'
import type { WorkflowImage, WorkflowVersion } from './workflow.ts'

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

test('Unmasked drawing creation retains its selected editable SVG without requiring source masks', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'drawing-evidence-test-'))
  try {
    const scene = drawingScene([drawingStar()])
    const drawing = await renderDrawing(scene)
    const image = {
      data: drawing.data,
      generated: drawing.data,
      generationPrompt: 'An orange eight-point star.',
      method: 'drawing' as const,
      svg: drawing.svg,
      drawingScene: scene,
    }
    const result = await writeImageEvidence(path.join(directory, 'atlas-star.png'), image, {
      prompt: 'An orange eight-point star.',
      model: 'drawing',
      quality: 'native',
      size: '128x96',
    })
    const record = JSON.parse(await readFile(path.join(result.directory, 'review.json'), 'utf8'))
    assert({
      given: 'a newly created drawing with no original image or preservation mask',
      should: 'save the final editable SVG and scene beside its evidence and leave mask paths absent',
      actual: [
        result.mask,
        (await readFile(result.svg!, 'utf8')) === drawing.svg,
        JSON.parse(await readFile(path.join(result.directory, record.files.drawingScene), 'utf8')),
        (await readFile(path.join(result.directory, record.files.image))).equals(Buffer.from(drawing.data)),
        record.method,
        record.files.source,
        record.files.mask,
        record.result,
      ],
      expected: [undefined, true, scene, true, 'drawing', undefined, undefined, 'atlas-star.png'],
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('Adaptive workflow evidence retains every candidate and binary asset separately from version metadata', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'workflow-evidence-test-'))
  try {
    const artwork = await sharp({ create: { width: 128, height: 96, channels: 4, background: '#206080' } })
      .png()
      .toBuffer()
    const canvas = { name: 'artwork.png', mediaType: 'image/png' as const, data: artwork }
    const plan = testMaskPlan()
    const mask = await maskFromPlan(plan, canvas)
    const generationMask = await maskFromPlan({ ...plan, editRegions: plan.generationRegions }, canvas)
    const firstScene = drawingScene([drawingStar()])
    const secondScene = drawingScene([drawingStar({ points: 6 })])
    const first = await renderDrawing(firstScene, { base: artwork })
    const second = await renderDrawing(secondScene, { base: artwork })
    const providerCrop = await sharp(artwork).extract({ left: 16, top: 16, width: 64, height: 48 }).png().toBuffer()
    const mixedPlan = {
      artworkPrompt: 'A flat blue canvas.',
      drawingPrompt: 'An orange eight-point star.',
      artworkScope: 'objects' as const,
      regenerateArtwork: false,
      reason: 'Retain the existing artwork and correct only the overlay.',
    }
    const best: WorkflowVersion = {
      data: first.data,
      generated: first.data,
      providerGenerated: providerCrop,
      focus: {
        size: '64x48',
        description: 'Synthetic crop for retained evidence.',
        geometry: {
          source: { left: 16, top: 16, width: 64, height: 48 },
          padding: { left: 0, top: 0, right: 0, bottom: 0 },
        },
      },
      generationPrompt: 'Exact first artwork prompt.',
      method: 'mixed',
      artwork,
      artworkMask: generationMask,
      mask,
      refinedMask: generationMask,
      svg: first.svg,
      drawingScene: firstScene,
      mixedPlan,
      review: {
        status: 'needs_revision',
        reason: 'The outline needs adjustment.',
        maskAdjusted: false,
        assessments: [
          { ...passedReview, verdict: 'needs_revision', score: 80, correction: 'Make the outline thinner.' },
        ],
      },
    }
    best.artworkGeneration = {
      data: artwork,
      generated: artwork,
      providerGenerated: providerCrop,
      focus: best.focus,
      generationPrompt: 'Exact paid raster request before overlays.',
    }
    const later: WorkflowVersion = {
      ...best,
      mask: undefined,
      data: second.data,
      generated: second.data,
      svg: second.svg,
      drawingScene: secondScene,
      feedback: 'Make the outline thinner.',
      generationPrompt: 'Exact corrective artwork prompt.',
      review: {
        status: 'needs_revision',
        reason: 'The new star has the wrong point count.',
        maskAdjusted: true,
        assessments: [
          {
            ...passedReview,
            verdict: 'needs_revision',
            score: 60,
            comparison: 'worse',
            correction: 'Restore eight points.',
          },
        ],
      },
    }
    const image: WorkflowImage = {
      ...best,
      versions: [best, later],
      attempts: { limit: 3, used: 2, selected: 1, stopped: 'time_limit', elapsedMs: 1200 },
    }
    const result = await writeImageEvidence(
      path.join(directory, 'atlas-mixed.png'),
      image,
      { canvas, mask, generationMask, plan, description: plan.changes },
      {
        prompt: 'A flat blue design with an orange eight-point star.',
        model: 'gpt-image-2.5-sunburst',
        quality: 'max',
        size: '128x96',
      },
    )
    const recordText = await readFile(path.join(result.directory, 'review.json'), 'utf8')
    const record = JSON.parse(recordText)
    const versions: unknown[][] = []
    const artworkVersions: unknown[][] = []
    for (const candidate of record.versions) {
      const metadata = JSON.parse(
        await readFile(
          path.join(result.directory, `attempt-${String(candidate.attempt).padStart(2, '0')}`, 'version.json'),
          'utf8',
        ),
      )
      versions.push([
        candidate.attempt,
        (await readFile(path.join(result.directory, candidate.files.image))).equals(
          Buffer.from(image.versions[candidate.attempt - 1]!.data),
        ),
        (await readFile(path.join(result.directory, candidate.files.providerGenerated))).equals(providerCrop),
        (await readFile(path.join(result.directory, candidate.files.artwork))).equals(artwork),
        (await readFile(path.join(result.directory, candidate.files.refinedMask))).equals(
          Buffer.from(generationMask.data),
        ),
        (await readFile(path.join(result.directory, candidate.files.svg), 'utf8')) ===
          image.versions[candidate.attempt - 1]!.svg,
        JSON.parse(await readFile(path.join(result.directory, candidate.files.mixedPlan), 'utf8')),
        metadata.review.assessments[0].score,
        metadata.feedback ?? null,
        metadata.focus.geometry.source,
        (await readFile(path.join(result.directory, candidate.files.providerCanvas))).equals(providerCrop),
        (await sharp(await readFile(path.join(result.directory, candidate.files.providerMask))).metadata()).width,
        (await readFile(path.join(result.directory, candidate.files.mask))).equals(
          Buffer.from(candidate.attempt === 1 ? mask.data : generationMask.data),
        ),
      ])
      const raster = JSON.parse(await readFile(path.join(result.directory, candidate.files.artworkGeneration), 'utf8'))
      artworkVersions.push([
        raster.generationPrompt,
        (await readFile(path.join(result.directory, raster.files.generated))).equals(artwork),
        (await readFile(path.join(result.directory, raster.files.providerGenerated))).equals(providerCrop),
        (await readFile(path.join(result.directory, raster.files.mask))).equals(Buffer.from(generationMask.data)),
        (await readFile(path.join(result.directory, candidate.files.artworkMask))).equals(
          Buffer.from(generationMask.data),
        ),
        raster.focus.geometry.source,
      ])
    }
    assert({
      given:
        'two mixed candidates with a retained earlier best, focused raw output, exact overlays and separate reviews',
      should:
        'keep every alternative and all evidence assets while recording selection, feedback and file references without serialized image buffers',
      actual: [
        record.version,
        record.attempts,
        versions,
        (await readFile(result.svg!, 'utf8')) === first.svg,
        (await readFile(path.join(result.directory, 'selected.png'))).equals(Buffer.from(first.data)),
        recordText.includes('"type": "Buffer"'),
        recordText.includes('"0":'),
        record.selected.files.svg,
        record.selected.generationPrompt,
        artworkVersions,
        (await readFile(path.join(result.directory, record.selected.artworkGeneration.files.generated))).equals(
          artwork,
        ),
      ],
      expected: [
        2,
        image.attempts,
        [
          [
            1,
            true,
            true,
            true,
            true,
            true,
            mixedPlan,
            80,
            null,
            { left: 16, top: 16, width: 64, height: 48 },
            true,
            64,
            true,
          ],
          [
            2,
            true,
            true,
            true,
            true,
            true,
            mixedPlan,
            60,
            'Make the outline thinner.',
            { left: 16, top: 16, width: 64, height: 48 },
            true,
            64,
            true,
          ],
        ],
        true,
        true,
        false,
        false,
        'final.svg',
        'Exact first artwork prompt.',
        Array.from({ length: 2 }, () => [
          'Exact paid raster request before overlays.',
          true,
          true,
          true,
          true,
          { left: 16, top: 16, width: 64, height: 48 },
        ]),
        true,
      ],
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
