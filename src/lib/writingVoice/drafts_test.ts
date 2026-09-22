import { mkdir, readdir, rm, symlink } from 'node:fs/promises'
import * as path from 'node:path'
import type { ToolHooks } from '#shared/models/Chat/ChatSession/mod.ts'
import { assert, test } from '#test'
import { writingDraftTools } from './draftChat.ts'
import { WritingDraftStore } from './drafts.ts'
import { currentDraftVersion, type WritingDraftView } from './draftTypes.ts'
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
  const store = new WritingDraftStore(f.voice, undefined, async () => 'Atlas Reply')
  try {
    const initial = await store.start(
      { meaning: 'The proposal is ready.', medium: 'Email' },
      'The proposal is ready.',
      'chat:sample',
    )
    const hooks = {
      context: { instructions: '', conversation: [{ role: 'user', content: 'Make the proposal warmer.' }] },
      writingDrafts: { list: () => [{ id: initial.id, turn: 1 }], focus: () => initial.id, link: async () => {} },
    } as unknown as ToolHooks
    const pending = writingDraftTools(hooks, store).draft({ meaning: initial.versions[0]!.text })
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
  const store = new WritingDraftStore(f.voice, undefined, async () => 'Atlas Reply')
  try {
    const outside = path.join(f.root, 'outside')
    await mkdir(outside)
    await mkdir(path.join(f.store.dir), { recursive: true })
    await symlink(outside, path.join(f.store.dir, 'drafts'))
    const failed = await failure(store.start({ meaning: 'A mock draft.' }, 'A mock draft.', 'chat:sample'))
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
  const store = new WritingDraftStore(f.voice, undefined, async () => 'Atlas Reply')
  try {
    const draft = await store.start({ meaning: 'The draft is ready.' }, 'The draft is ready.', 'chat:sample')
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

test('a draft Sky writes in chat has no record until the owner uses it, and a deleted record is written afresh', async () => {
  const f = await voiceFixture()
  const store = new WritingDraftStore(f.voice, undefined, async () => 'Atlas Reply')
  try {
    const links: { id: string; turn: number }[] = []
    let focus: string | undefined
    const hooks = {
      context: { instructions: '', conversation: [{ role: 'user', content: 'Tell Jane Doe the proposal is ready.' }] },
      writingDrafts: {
        list: () => links,
        focus: () => focus,
        link: async (id: string) => {
          links.push({ id, turn: 1 })
        },
      },
    } as unknown as ToolHooks
    const tools = writingDraftTools(hooks, store)
    const written = await tools.draft({ meaning: 'The proposal is ready.', medium: 'Email', recipient: 'Jane Doe' })
    const files = () => readdir(path.join(f.store.dir, 'drafts')).catch(() => [] as string[])
    assert({
      given: 'a new draft written through the chat tool',
      should: 'return its words with no record, no link, and no file in the notebook',
      actual: [written.draft, written.draftId, written.draftRevision, links, await files()],
      expected: ['The proposal is ready.', undefined, undefined, [], []],
    })
    const used = await store.adopt(
      store.initial({ meaning: written.draft }, written.draft, 'chat:sample', 'a'.repeat(32)),
    )
    links.push({ id: used.id, turn: 1 })
    focus = used.id
    await rm(path.join(f.store.dir, 'drafts', `${used.id}.md`))
    const afresh = await tools.draft({ meaning: 'The proposal is ready for Friday.' })
    assert({
      given: 'the selected draft’s file deleted from the notebook',
      should: 'write the requested words as a new draft instead of failing on the missing record',
      actual: [used.id.endsWith('_Atlas-Reply'), afresh.draft, afresh.draftId, await files()],
      expected: [true, 'The proposal is ready for Friday.', undefined, []],
    })
  } finally {
    await store.idle()
    await f.dispose()
  }
})

test('asking Sky to revise an unsaved draft is its first use, and a failed revision saves nothing', async () => {
  let fail = true
  const f = await voiceFixture({
    draft: async (input) => {
      if (fail) throw new Error('The model is temporarily unavailable.')
      return `${input.meaning} Thank you for your patience.`
    },
  })
  const store = new WritingDraftStore(f.voice, undefined, async () => 'Atlas Reply')
  try {
    const links: { id: string; turn: number }[] = []
    const hooks = {
      context: { instructions: '', conversation: [{ role: 'user', content: 'Make it warmer.' }] },
      writingDrafts: {
        list: () => links,
        focus: () => undefined,
        link: async (id: string, turn = 9) => {
          links.push({ id, turn })
        },
      },
    } as unknown as ToolHooks
    const shown: WritingDraftView = {
      ...store.initial({ meaning: 'The proposal is ready.' }, 'The proposal is ready.', 'chat:sample', 'a'.repeat(32)),
      turn: 1,
      unsaved: true,
    }
    const waiting = async () => (links.length ? [] : [shown])
    const tools = writingDraftTools(hooks, store, waiting)
    const files = () => readdir(path.join(f.store.dir, 'drafts')).catch(() => [] as string[])
    const failed = await failure(tools.draft({ meaning: 'Warmer.', draftId: shown.id, draftRevision: 1 }))
    const afterFailure = [await files(), links.length]
    const outdated = await failure(tools.draft({ meaning: 'Warmer.', draftId: shown.id, draftRevision: 2 }))
    fail = false
    const revised = await tools.draft({ meaning: 'Warmer.', draftId: shown.id, draftRevision: 1 })
    const saved = await store.require(revised.draftId!)
    assert({
      given: 'a revision requested for words with no record, first failing, then outdated, then succeeding',
      should: 'save nothing until the revision exists, then save the record where the words first appeared',
      actual: [
        failed.includes('temporarily unavailable'),
        afterFailure,
        outdated.includes('draft changed'),
        revised.draftId?.endsWith('_Atlas-Reply'),
        revised.draftRevision,
        links,
        saved.versions.map((v) => [v.author, v.text, v.direction]),
        await files(),
      ],
      expected: [
        true,
        [[], 0],
        true,
        true,
        2,
        [{ id: revised.draftId, turn: 1 }],
        [
          ['sky', 'The proposal is ready.', ''],
          ['sky', 'The proposal is ready. Thank you for your patience.', 'Make it warmer.'],
        ],
        [`${revised.draftId}.md`],
      ],
    })
  } finally {
    await store.idle()
    await f.dispose()
  }
})

test('an edit the owner supplies in chat saves the unsaved draft it changes and teaches from that pair', async () => {
  const f = await voiceFixture()
  const store = new WritingDraftStore(f.voice, undefined, async () => 'Atlas Reply')
  try {
    const links: { id: string; turn: number }[] = []
    const hooks = {
      context: { instructions: '', conversation: [{ role: 'user', content: 'Use my wording.' }] },
      writingDrafts: {
        list: () => links,
        focus: () => undefined,
        link: async (id: string, turn = 9) => {
          links.push({ id, turn })
        },
      },
    } as unknown as ToolHooks
    const shown: WritingDraftView = {
      ...store.initial(
        { meaning: 'The draft is ready.' },
        'I wanted to let you know that the draft is ready.',
        'chat:sample',
        'b'.repeat(32),
      ),
      turn: 2,
      unsaved: true,
    }
    const tools = writingDraftTools(hooks, store, async () => (links.length ? [] : [shown]))
    const learned = (await tools.learn({
      source: 'chat:sample',
      medium: 'Email',
      recipient: 'Jane Doe',
      context: '',
      original: 'I wanted to let you know that the draft is ready.',
      revised: 'The draft is ready.',
    })) as { draftId: string; draftRevision: number }
    await store.idle()
    const saved = await store.require(learned.draftId)
    assert({
      given: 'the owner’s own edit of words that had no record, matched by their exact text',
      should: 'save the record with both versions at the turn the words appeared, and learn from that one pair',
      actual: [
        links,
        learned.draftRevision,
        saved.versions.map((v) => [v.author, v.text]),
        (await f.store.list(`draft:${learned.draftId}`)).map((example) => [example.original, example.revised]),
      ],
      expected: [
        [{ id: learned.draftId, turn: 2 }],
        2,
        [
          ['sky', 'I wanted to let you know that the draft is ready.'],
          ['you', 'The draft is ready.'],
        ],
        [['I wanted to let you know that the draft is ready.', 'The draft is ready.']],
      ],
    })
  } finally {
    await store.idle()
    await f.dispose()
  }
})
