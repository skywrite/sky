import { MockLanguageModelV4 } from 'ai/test'
import { assert, test } from '#test'
import { WritingDraftId } from './draftId.ts'
import { createDraftName, draftStamp } from './draftName.ts'
import { WritingDraftStore } from './drafts.ts'
import { voiceFixture } from './testHelpers.ts'

test('draft names preserve the model summary’s case and safely name concurrent drafts', async () => {
  const model = new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: 'text', text: 'Atlas API / Launch Update' }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
      warnings: [],
    },
  })
  const f = await voiceFixture()
  const store = new WritingDraftStore(
    f.voice,
    () => '2025-03-15 12:34:56 UTC',
    createDraftName(() => ({ model })),
  )
  try {
    const drafts = await Promise.all([
      store.start({ meaning: 'The API is ready.' }, 'The API is ready.', 'chat:first'),
      store.start({ meaning: 'The API needs review.' }, 'The API needs review.', 'chat:second'),
    ])
    const fork = await store.fork(drafts[0]!.id, 'chat:branch')
    assert({
      given: 'two model-named drafts and a branch created within the same second',
      should: 'keep distinct readable records with the model’s capitalization and no overwritten content',
      actual: [
        drafts.map((draft) => draft.id).sort(),
        new Set([...drafts.map((draft) => draft.id), fork.id]).size,
        (await Promise.all(drafts.map((draft) => store.require(draft.id)))).map((draft) => draft.versions[0]!.text),
        draftStamp('2025-03-15 12:34 UTC'),
      ],
      expected: [
        ['2025-03-15_12-34-56Z_Atlas-API-Launch-Update', '2025-03-15_12-34-56Z_Atlas-API-Launch-Update-2'],
        3,
        ['The API is ready.', 'The API needs review.'],
        '2025-03-15_12-34-00Z',
      ],
    })
  } finally {
    await store.idle()
    await f.dispose()
  }
})

test('draft identifiers accept old links and readable names while excluding paths', () => {
  assert({
    given: 'legacy and new names mixed with unsafe filenames',
    should: 'keep existing links valid and reject traversal, separators, and unbounded names',
    actual: ['a'.repeat(32), '2025-03-15_12-00-00Z_Atlas-API', '../outside', 'a/b', 'a\\b', '..', 'x'.repeat(161)].map(
      (id) => WritingDraftId.safeParse(id).success,
    ),
    expected: [true, true, false, false, false, false, false],
  })
})

test('a naming failure preserves the completed draft under a descriptive fallback', async () => {
  const name = createDraftName(() => {
    throw new Error('Naming service unavailable')
  })
  assert({
    given: 'the writer finishes but the small naming model is unavailable',
    should: 'still provide a safe, case-preserving name from the completed text',
    actual: await name({ meaning: 'The Atlas API is ready.' }, 'The Atlas API is ready.'),
    expected: 'The-Atlas-API-is-ready',
  })
})
