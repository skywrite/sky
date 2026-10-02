import { assert, test } from '#test'
import { imageCreationStamp, imageFileName, imageSummary } from './imageName.ts'

test('image filenames use a five to nine word content summary without truncating names', async () => {
  let calls = 0
  const generate = async () => {
    calls++
    return 'Atlas API launch milestones and review checklist'
  }
  const summaries = await Promise.all([
    imageSummary('Atlas API launch review checklist', 'Captured notes', { generate }),
    imageSummary('Atlas API launch review checklist with owners and deadlines', 'Captured notes', { generate }),
    imageSummary('Atlas', 'The API launch has milestones and a review checklist.', { generate }),
  ])
  assert({
    given: 'suitable extracted titles and a short title that needs a summary',
    should: 'keep full words and acronyms, requesting a name only when needed',
    actual: [summaries, calls],
    expected: [
      [
        'Atlas-API-launch-review-checklist',
        'Atlas-API-launch-review-checklist-with-owners-and-deadlines',
        'Atlas-API-launch-milestones-and-review-checklist',
      ],
      1,
    ],
  })
  assert({
    given: 'a summary and grouped images with different extensions',
    should: 'preserve the extension and capture order under a readable creation timestamp',
    actual: [
      imageFileName('2026-01-27_153000', summaries[0], '.HEIC'),
      imageFileName('2026-01-27_153000', summaries[0], '.png', 2),
      /^\d{4}-\d{2}-\d{2}_\d{6}$/.test(imageCreationStamp()),
    ],
    expected: [
      '2026-01-27_153000_Atlas-API-launch-review-checklist.HEIC',
      '2026-01-27_153000_Atlas-API-launch-review-checklist-2.png',
      true,
    ],
  })
})

test('an unavailable or invalid naming model still saves a descriptive bounded filename', async () => {
  const names: string[] = []
  for (const reply of [
    null,
    'Too short',
    'First line\nSecond line',
    'A summary with far too many words to use in this filename',
  ]) {
    names.push(
      await imageSummary('Atlas plan', 'Captured notes', {
        generate: async () => {
          if (reply === null) throw new Error('Synthetic naming outage')
          return reply
        },
      }),
    )
  }
  assert({
    given: 'a successful read followed by naming failure',
    should: 'keep a five to nine word filename grounded in the captured subject',
    actual: names,
    expected: Array(4).fill('Image-of-Atlas-plan-saved-for-reference'),
  })
})

test('cancelling image naming stops the import instead of silently filing a fallback', async () => {
  const controller = new AbortController()
  let cancelled = false
  try {
    await imageSummary('Atlas', 'Captured notes', {
      signal: controller.signal,
      generate: async (_title, _text, signal) => {
        assert({
          given: 'a cancellable image import',
          should: 'cancel its naming request too',
          actual: signal,
          expected: controller.signal,
        })
        controller.abort()
        throw new Error('Synthetic cancellation')
      },
    })
  } catch {
    cancelled = controller.signal.aborted
  }
  assert({ given: 'cancellation during naming', should: 'stop before filing', actual: cancelled, expected: true })
})
