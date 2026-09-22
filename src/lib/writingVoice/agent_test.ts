import type { Tool } from 'ai'
import { assert, test } from '#test'
import { AUTO_COMPACT_LESSONS } from './agent.ts'
import { parseEditId } from './draftEdits.ts'
import { failure, intelligence, SAMPLE, voiceFixture } from './testHelpers.ts'
import { createWritingVoiceTools, WRITING_VOICE_CHAT_INSTRUCTIONS } from './tools.ts'

test('The writing agent asks one grounded question and learns only from the chosen answer', async () => {
  const seen: string[] = []
  const f = await voiceFixture({
    learn: async (example) => {
      seen.push(example.answer!)
      return intelligence.learn(example)
    },
  })
  try {
    const example = await f.edited()
    const learned = await f.learning.answer(example.id, example.revision, { option: 1 })
    await f.voice.idle()
    const version = (await f.drafts.require(parseEditId(example.id).draftId)).versions[1]!
    assert({
      given: 'two suggested reasons and the second selected',
      should: 'save the question, chosen explanation, and scoped lesson together on the edited version',
      actual: [example.question!.options.length, version.question, version.answer, version.lesson, seen],
      expected: [
        2,
        example.question,
        'This recipient already knows the context.',
        learned.lesson,
        ['This recipient already knows the context.'],
      ],
    })
    assert({
      given: 'a stale answer revision',
      should: 'preserve the settled answer',
      actual: (await failure(f.learning.answer(example.id, example.revision, { option: 0 }))).includes('changed'),
      expected: true,
    })
  } finally {
    await f.dispose()
  }
})

test('A failed learning call preserves the owner’s custom answer and can resume', async () => {
  let fail = true
  const f = await voiceFixture({
    learn: async (example) => {
      if (fail) throw new Error('Model unavailable')
      return intelligence.learn(example)
    },
  })
  try {
    const example = await f.edited()
    const answer = 'Only for brief project updates. Keep introductions in letters.'
    const interrupted = await f.learning.answer(example.id, example.revision, { text: answer })
    fail = false
    const learned = await f.learning.prepare(example.id)
    assert({
      given: 'custom feedback followed by a model outage',
      should: 'persist the exact feedback and retry without asking again',
      actual: [interrupted.answer, interrupted.error, learned.lesson?.text, learned.error],
      expected: [answer, 'Model unavailable', answer, undefined],
    })
  } finally {
    await f.dispose()
  }
})

test('Invented change excerpts never become a learning question', async () => {
  const f = await voiceFixture({
    question: async (example) => ({
      ...(await intelligence.question(example)),
      before: 'Words never present in this draft.',
    }),
  })
  try {
    const example = await f.edited()
    assert({
      given: 'a model question about text that was not changed',
      should: 'retain the pair for retry without presenting invented evidence',
      actual: [example.question, Boolean(example.error), (await f.learning.edits()).length],
      expected: [undefined, true, 1],
    })
  } finally {
    await f.dispose()
  }
})

test('Every draft loads current shared rules and confirmed lessons, including within the same chat', async () => {
  const inputs: Parameters<typeof intelligence.draft>[0][] = []
  const f = await voiceFixture({
    draft: async (input) => {
      inputs.push(input)
      return input.meaning
    },
  })
  try {
    await f.voice.draft({ meaning: 'The draft is ready.', medium: 'Email' })
    const example = await f.edited()
    await f.learning.answer(example.id, example.revision, { option: 0 })
    await f.voice.idle()
    await f.edited({ ...SAMPLE, source: 'chat:unconfirmed' })
    // Sky's own wording is never evidence: a draft it revised, which the owner has not accepted, teaches nothing.
    const untouched = await f.drafts.start({ meaning: 'A reply.', medium: 'Email' }, 'A reply.', 'chat:sky-only')
    await f.drafts.revise(untouched.id, 1, 'A warmer reply.', 'sky', 'Make it warmer.')
    const rules = await f.store.rules()
    await f.store.saveRules('Use straight quotation marks.\n', rules.revision)
    await f.voice.draft({ meaning: 'The draft is ready.', medium: 'Email' })
    assert({
      given: 'a rule edit and a confirmed lesson between drafts, beside an unanswered edit and a draft only Sky wrote',
      should: 'use both immediately, and learn from nothing the owner did not confirm',
      actual: [
        inputs[1].rules.trim(),
        inputs[1].lessons.length,
        inputs[1].examples.length,
        inputs[1].examples[0].answer,
      ],
      expected: ['Use straight quotation marks.', 1, 1, 'I prefer stating the point directly in emails.'],
    })
  } finally {
    await f.dispose()
  }
})

test('Confirmed lessons fold into the rules automatically after the learning threshold', async () => {
  const f = await voiceFixture()
  try {
    for (let i = 0; i < AUTO_COMPACT_LESSONS; i++) {
      const example = await f.edited({ ...SAMPLE, source: `chat:sample-${i}` })
      await f.learning.answer(example.id, example.revision, { option: 0 })
      await f.voice.idle()
    }
    const status = await f.voice.status()
    const folded = await Promise.all(
      (await f.drafts.ids()).map(async (id) => (await f.drafts.require(id)).versions[1]!.folded),
    )
    assert({
      given: 'eight confirmed lessons',
      should: 'save them in the rules, stop reading them from the drafts, and keep every draft',
      actual: [
        status.edits.length,
        status.rules.folding,
        status.rules.text.includes('I prefer stating the point directly in emails.'),
        status.compactionError,
        folded,
      ],
      expected: [0, [], true, null, Array(AUTO_COMPACT_LESSONS).fill(true)],
    })
  } finally {
    await f.dispose()
  }
})

test('The shared chat tool captures and asks without choosing an answer for the owner', async () => {
  let questions = 0
  const f = await voiceFixture()
  try {
    const tools = createWritingVoiceTools(f.drafts, {
      source: 'chat:tool',
      onQuestion: async () => {
        questions++
        return undefined
      },
    })
    const tool = tools.me_voice as Tool
    assert({
      given: 'the existing me_voice tool ID',
      should: 'introduce Ghostwriter consistently to the chat model',
      actual: [
        typeof tool.description === 'string' && tool.description.startsWith('Ghostwriter drafts'),
        WRITING_VOICE_CHAT_INSTRUCTIONS.includes('Ghostwriter is the drafting agent.'),
      ],
      expected: [true, true],
    })
    const result = (await tool.execute!(
      { ...SAMPLE, action: 'learn' },
      { toolCallId: 'sample-call', messages: [], context: undefined },
    )) as { success: boolean }
    const pending = (await f.learning.edits())[0]!
    assert({
      given: 'the user leaves the question unanswered',
      should: 'save the edit as one draft with its question pending and infer no answer',
      actual: [
        result.success,
        questions,
        (await f.drafts.require(parseEditId(pending.id).draftId)).source,
        Boolean(pending.question),
        pending.answer,
      ],
      expected: [true, 1, 'chat:tool', true, undefined],
    })
  } finally {
    await f.dispose()
  }
})
