import { Hono } from 'hono'
import { parseEditId } from '#lib/writingVoice/draftEdits.ts'
import { SAMPLE, voiceFixture } from '#lib/writingVoice/testHelpers.ts'
import { assert, test } from '#test'
import { createWritingVoiceRoutes } from './writingVoice.ts'

test('Writing voice HTTP saves the pair, offers two choices, and preserves a custom answer', async () => {
  const f = await voiceFixture()
  try {
    const app = new Hono().route('/voice', createWritingVoiceRoutes(f.drafts))
    const created = await app.request('/voice/edits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(SAMPLE),
    })
    const { edit: example } = await created.json()
    const answered = await app.request(`/voice/edits/${encodeURIComponent(example.id)}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision: example.revision, text: 'Only for short status emails.' }),
    })
    const { edit: learned } = await answered.json()
    const status = await app.request('/voice')
    const draft = await f.drafts.require(parseEditId(example.id).draftId)
    assert({
      given: 'a revision submitted through Settings and a custom reason',
      should: 'persist one draft holding the pair and the confirmed scoped learning',
      actual: [
        created.status,
        answered.status,
        status.status,
        example.question.options.length,
        draft.source,
        draft.versions.map((version) => version.text),
        learned.answer,
        learned.lesson.scope,
        ((await status.json()) as { edits: unknown[] }).edits.length,
      ],
      expected: [
        200,
        200,
        200,
        2,
        'settings',
        [SAMPLE.original, SAMPLE.revised],
        'Only for short status emails.',
        'Email',
        1,
      ],
    })
    const stale = await app.request(`/voice/edits/${encodeURIComponent(example.id)}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision: example.revision, option: 0 }),
    })
    assert({
      given: 'another tab answering an older revision',
      should: 'report the conflict',
      actual: stale.status,
      expected: 409,
    })
  } finally {
    await f.dispose()
  }
})

test('Writing voice HTTP rejects cross-origin writes and ambiguous answers', async () => {
  const f = await voiceFixture()
  try {
    const app = createWritingVoiceRoutes(f.drafts)
    const rejected = await app.request('http://localhost/edits', {
      method: 'POST',
      headers: { Origin: 'https://example.com', 'Content-Type': 'application/json' },
      body: JSON.stringify(SAMPLE),
    })
    const example = await f.edited()
    const ambiguous = await app.request(`/edits/${encodeURIComponent(example.id)}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision: example.revision, option: 0, text: 'A different reason.' }),
    })
    assert({
      given: 'a foreign origin and an answer containing both modes',
      should: 'write neither request',
      actual: [rejected.status, ambiguous.status, (await f.learning.get(example.id)).answer, await f.drafts.ids()],
      expected: [403, 400, undefined, [parseEditId(example.id).draftId]],
    })
  } finally {
    await f.dispose()
  }
})
