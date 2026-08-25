import { assert, test } from '#test'
import { buildImageArtifact, imageArtifactFileName, promptTitle } from './artifact.ts'

test('imageArtifactFileName', () => {
  assert({
    given: 'a generation time and title',
    should: 'produce a chronological actions/images path',
    expected: 'actions/images/09-15_image_Atlas-launch-poster.md',
    actual: imageArtifactFileName('09:15', 'Atlas launch poster'),
  })
})

test('promptTitle', () => {
  assert({
    given: 'a short prompt',
    should: 'return it verbatim',
    expected: 'A watercolor lighthouse at dawn',
    actual: promptTitle('A watercolor lighthouse at dawn'),
  })

  const long = promptTitle(
    'A sweeping photorealistic mountain panorama at golden hour with a tiny hiker on the ridgeline and long shadows across the valley floor',
  )
  assert({
    given: 'a long prompt',
    should: 'ellipsize at a word boundary within the cap',
    expected: true,
    actual: long.endsWith('…') && long.length <= 81 && !long.includes('  '),
  })
})

test('buildImageArtifact', () => {
  const artifact = buildImageArtifact({
    date: '2026-08-24',
    time: '09:15',
    prompt: 'A watercolor poster of a lighthouse at dawn, the word ATLAS across the top',
    model: 'gpt-image-2',
    quality: 'high',
    size: '1024x1536',
    refs: [],
    files: ['/Users/jane/Desktop/2026-08-24_image_A-watercolor-poster.png'],
    report: 'Generated 1 image.',
  })

  assert({
    given: 'a completed generation',
    should: 'record provenance: when, model, saved path, prompt, settings, report',
    expected: [true, true, true, true, true, true],
    actual: [
      artifact.includes('created: 2026-08-24 09:15'),
      artifact.includes('model: gpt-image-2'),
      artifact.includes('- /Users/jane/Desktop/2026-08-24_image_A-watercolor-poster.png'),
      artifact.includes('**Prompt:** A watercolor poster of a lighthouse at dawn'),
      artifact.includes('Settings: gpt-image-2, quality high, 1024x1536'),
      artifact.includes('Generated 1 image.'),
    ],
  })

  assert({
    given: 'a tagged artifact',
    should: 'carry the images tag',
    expected: true,
    actual: artifact.includes('tags: images'),
  })
})

test('buildImageArtifact — reference images', () => {
  const artifact = buildImageArtifact({
    date: '2026-08-24',
    time: '14:05',
    prompt: 'Make the sky stormy',
    model: 'gpt-image-2',
    quality: 'medium',
    refs: ['lighthouse.png'],
    files: ['/Users/jane/Desktop/2026-08-24_image_Make-the-sky-stormy.png'],
    report: 'Edited 1 image.',
  })

  assert({
    given: 'a generation that drew from reference images',
    should: 'name them',
    expected: true,
    actual: artifact.includes('**Reference images:** lighthouse.png'),
  })

  assert({
    given: 'settings without an explicit size',
    should: 'omit the size from the settings line',
    expected: true,
    actual: artifact.includes('Settings: gpt-image-2, quality medium\n'),
  })
})
