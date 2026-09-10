import { symlink, mkdir } from 'node:fs/promises'
import * as path from 'node:path'
import type { ToolHooks } from '#shared/models/Chat/ChatSession/mod.ts'
import { assert, test } from '#test'
import { writingDraftTools } from './draftChat.ts'
import { WritingDraftStore } from './drafts.ts'
import { currentDraftVersion } from './draftTypes.ts'
import { failure, voiceFixture } from './testHelpers.ts'

test('a slow AI revision cannot overwrite an owner edit and compaction preserves draft history', async () => {
  let finish: ((text: string) => void) | undefined
  let started: (() => void) | undefined
  const running = new Promise<void>((resolve) => {
    started = resolve
  })
  const f = await voiceFixture({
    draft: async () => {
      started!()
      return new Promise((resolve) => {
        finish = resolve
      })
    },
  })
  const store = new WritingDraftStore(f.voice)
  try {
    const initial = await store.create(
      store.initial({ meaning: 'The proposal is ready.', medium: 'Email' }, 'The proposal is ready.', 'chat:sample'),
    )
    const hooks = {
      context: { instructions: '', conversation: [{ role: 'user', content: 'Make the proposal warmer.' }] },
      writingDrafts: { list: () => [{ id: initial.id, turn: 1 }], focus: () => initial.id, link: async () => {} },
    } as unknown as ToolHooks
    const pending = writingDraftTools(hooks, store, 'chat:sample').draft({ meaning: initial.versions[0]!.text })
    await running
    await store.revise(initial.id, 1, 'The proposal is ready for Friday.', 'you', 'Include the agreed day.')
    finish!('I am glad the proposal is ready.')
    const result = await failure(pending)
    store.learn(initial.id)
    await store.idle()
    assert({
      given: 'an owner saves a newer draft while the writer is generating',
      should: 'reject the obsolete model result and learn only the owner’s saved edit',
      actual: [
        result.includes('draft changed'),
        currentDraftVersion(await store.require(initial.id)).text,
        (await f.store.list())[0]?.answer,
      ],
      expected: [true, 'The proposal is ready for Friday.', 'Include the agreed day.'],
    })
    await f.voice.compact()
    assert({
      given: 'learning examples compacted into rules',
      should: 'keep the full before/after history and explanation in the draft',
      actual: (await store.require(initial.id)).versions.map((v) => [v.text, v.explanation]),
      expected: [
        ['The proposal is ready.', undefined],
        ['The proposal is ready for Friday.', 'Include the agreed day.'],
      ],
    })
  } finally {
    await store.idle()
    await f.dispose()
  }
})

test('draft storage refuses paths outside its records, including symbolic links', async () => {
  const f = await voiceFixture()
  const store = new WritingDraftStore(f.voice)
  try {
    const outside = path.join(f.root, 'outside')
    await mkdir(outside)
    await mkdir(path.join(f.store.dir), { recursive: true })
    await symlink(outside, path.join(f.store.dir, 'drafts'))
    const failed = await failure(
      store.create(store.initial({ meaning: 'A mock draft.' }, 'A mock draft.', 'chat:sample')),
    )
    assert({
      given: 'a drafts directory replaced with a symbolic link',
      should: 'refuse to follow it when saving a draft',
      actual: failed,
      expected: 'Draft files cannot be symbolic links.',
    })
  } finally {
    await f.dispose()
  }
})

test('an explanation saved with an edit survives a failed learning model and retries without another question', async () => {
  let fail = true
  let questions = 0
  const f = await voiceFixture({
    question: async () => {
      questions++
      throw new Error('No question should be needed.')
    },
    learn: async (example) => {
      if (fail) throw new Error('The model is temporarily unavailable.')
      return { scope: 'Email updates', text: example.answer! }
    },
  })
  const store = new WritingDraftStore(f.voice)
  try {
    const draft = await store.create(
      store.initial({ meaning: 'The draft is ready.' }, 'The draft is ready.', 'chat:sample'),
    )
    await store.revise(draft.id, 1, 'Please review the draft.', 'you', 'Say what I need the recipient to do.')
    store.learn(draft.id)
    await store.idle()
    const example = (await f.store.list(`draft:${draft.id}`))[0]!
    fail = false
    const learned = await f.voice.prepare(example.id)
    assert({
      given: 'the learning model fails after a direct edit is saved',
      should: 'retain the revision and exact explanation, then finish learning without repeating the question',
      actual: [
        currentDraftVersion(await store.require(draft.id)).text,
        example.answer,
        example.error,
        learned.lesson?.text,
        questions,
      ],
      expected: [
        'Please review the draft.',
        'Say what I need the recipient to do.',
        'The model is temporarily unavailable.',
        'Say what I need the recipient to do.',
        0,
      ],
    })
  } finally {
    await store.idle()
    await f.dispose()
  }
})
