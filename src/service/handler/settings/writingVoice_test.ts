import { Hono } from 'hono'
import { SAMPLE, voiceFixture } from '#lib/writingVoice/testHelpers.ts'
import { assert, test } from '#test'
import { createWritingVoiceRoutes } from './writingVoice.ts'

test('Writing voice HTTP saves the pair, offers two choices, and preserves a custom answer', async () => {
  const f = await voiceFixture()
  try {
    const app = new Hono().route('/voice', createWritingVoiceRoutes(f.voice))
    const created = await app.request('/voice/examples', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(SAMPLE),
    })
    const { example } = await created.json()
    const answered = await app.request(`/voice/examples/${example.id}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision: example.revision, text: 'Only for short status emails.' }),
    })
    const { example: learned } = await answered.json()
    const status = await app.request('/voice')
    assert({
      given: 'a revision submitted through Settings and a custom reason',
      should: 'persist a single example and confirmed scoped learning',
      actual: [
        created.status,
        answered.status,
        status.status,
        example.question.options.length,
        learned.source,
        learned.answer,
        learned.lesson.scope,
      ],
      expected: [200, 200, 200, 2, 'settings', 'Only for short status emails.', 'Email'],
    })
    const stale = await app.request(`/voice/examples/${example.id}/answer`, {
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
    const app = createWritingVoiceRoutes(f.voice)
    const rejected = await app.request('http://localhost/examples', {
      method: 'POST',
      headers: { Origin: 'https://example.com', 'Content-Type': 'application/json' },
      body: JSON.stringify(SAMPLE),
    })
    const example = (await f.voice.capture(SAMPLE))!
    const ambiguous = await app.request(`/examples/${example.id}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision: example.revision, option: 0, text: 'A different reason.' }),
    })
    assert({
      given: 'a foreign origin and an answer containing both modes',
      should: 'write neither request',
      actual: [rejected.status, ambiguous.status, (await f.store.get(example.id))?.answer],
      expected: [403, 400, undefined],
    })
  } finally {
    await f.dispose()
  }
})
