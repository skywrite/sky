import { assert, test } from '#test'
import { captureOutboxRevision } from './outbox.ts'
import { SAMPLE, sampleOutboxItem, voiceFixture } from './testHelpers.ts'

test('Outbox edits and accepted AI revisions become shared examples without treating untouched drafts as lessons', async () => {
  const f = await voiceFixture()
  try {
    const item = sampleOutboxItem()
    const unchanged = await captureOutboxRevision(f.voice, item, item, true)
    const edited = (await captureOutboxRevision(f.voice, item, { ...item, draft: SAMPLE.revised }))!
    const repeated = await captureOutboxRevision(
      f.voice,
      { ...item, draft: SAMPLE.revised },
      { ...item, draft: SAMPLE.revised },
      true,
    )
    const directed = {
      ...item,
      draft: 'The project draft is ready.',
      replyDirections: [{ at: '2025-03-15', text: 'Use a direct opening.', sourceVersion: 'v1' }],
    }
    const accepted = (await captureOutboxRevision(f.voice, directed, directed, true))!
    assert({
      given: 'an untouched draft, a saved edit, and an accepted revision directed by the owner',
      should: 'retain only actual learning pairs with their source and direction',
      actual: [
        unchanged,
        repeated,
        edited.source,
        edited.original,
        edited.revised,
        accepted.instruction,
        (await f.store.list()).length,
      ],
      expected: [null, null, `outbox:${item.id}`, SAMPLE.original, SAMPLE.revised, 'Use a direct opening.', 2],
    })
  } finally {
    await f.dispose()
  }
})
