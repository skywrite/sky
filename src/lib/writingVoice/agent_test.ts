import type { Tool } from 'ai'
import { assert, test } from '#test'
import { AUTO_COMPACT_EXAMPLES } from './agent.ts'
import { failure, intelligence, SAMPLE, voiceFixture } from './testHelpers.ts'
import { createWritingVoiceTools } from './tools.ts'

test('The writing agent asks one grounded question and learns only from the chosen answer', async () => {
  const seen: string[] = []
  const f = await voiceFixture({
    learn: async (example) => {
      seen.push(example.answer!)
      return intelligence.learn(example)
    },
  })
  try {
    const example = (await f.voice.capture(SAMPLE))!
    const learned = await f.voice.answer(example.id, example.revision, { option: 1 })
    await f.voice.idle()
    const saved = (await f.store.get(example.id))!
    assert({
      given: 'two suggested reasons and the second selected',
      should: 'save the question, chosen explanation, and scoped lesson together',
      actual: [example.question!.options.length, saved.answer, saved.lesson, seen],
      expected: [
        2,
        'This recipient already knows the context.',
        learned.lesson,
        ['This recipient already knows the context.'],
      ],
    })
    assert({
      given: 'a stale answer revision',
      should: 'preserve the settled answer',
      actual: (await failure(f.voice.answer(example.id, example.revision, { option: 0 }))).includes('changed'),
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
    const example = (await f.voice.capture(SAMPLE))!
    const answer = 'Only for brief project updates. Keep introductions in letters.'
    const interrupted = await f.voice.answer(example.id, example.revision, { text: answer })
    fail = false
    const learned = await f.voice.prepare(example.id)
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
    const example = (await f.voice.capture(SAMPLE))!
    assert({
      given: 'a model question about text that was not changed',
      should: 'retain the pair for retry without presenting invented evidence',
      actual: [example.question, Boolean(example.error), (await f.store.list()).length],
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
    const example = (await f.voice.capture(SAMPLE))!
    await f.voice.answer(example.id, example.revision, { option: 0 })
    await f.voice.idle()
    await f.store.capture({ ...SAMPLE, source: 'chat:unconfirmed' })
    const rules = await f.store.rules()
    await f.store.saveRules('Use straight quotation marks.\n', rules.revision)
    await f.voice.draft({ meaning: 'The draft is ready.', medium: 'Email' })
    assert({
      given: 'a rule edit and a confirmed lesson between drafts',
      should: 'use both immediately and exclude unconfirmed hypotheses',
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

test('Confirmed examples compact automatically after the learning threshold', async () => {
  const f = await voiceFixture()
  try {
    for (let i = 0; i < AUTO_COMPACT_EXAMPLES; i++) {
      const example = (await f.voice.capture({ ...SAMPLE, source: `chat:sample-${i}` }))!
      await f.voice.answer(example.id, example.revision, { option: 0 })
      await f.voice.idle()
    }
    const status = await f.voice.status()
    assert({
      given: 'eight confirmed examples',
      should: 'save their lessons in the rules and remove their raw files',
      actual: [
        status.examples.length,
        status.rules.compacted.length,
        status.rules.text.includes('I prefer stating the point directly in emails.'),
        status.compactionError,
      ],
      expected: [0, AUTO_COMPACT_EXAMPLES, true, null],
    })
  } finally {
    await f.dispose()
  }
})

test('The shared chat tool captures and asks without choosing an answer for the owner', async () => {
  let questions = 0
  const f = await voiceFixture()
  try {
    const tools = createWritingVoiceTools(f.voice, {
      source: 'chat:tool',
      onQuestion: async () => {
        questions++
        return undefined
      },
    })
    const tool = tools.me_voice as Tool
    const result = (await tool.execute!(
      { ...SAMPLE, action: 'learn' },
      { toolCallId: 'sample-call', messages: [], context: undefined },
    )) as { success: boolean }
    assert({
      given: 'the user leaves the question unanswered',
      should: 'save one pending example and infer no answer',
      actual: [result.success, questions, (await f.store.list())[0].source, (await f.store.list())[0].answer],
      expected: [true, 1, 'chat:tool', undefined],
    })
  } finally {
    await f.dispose()
  }
})
