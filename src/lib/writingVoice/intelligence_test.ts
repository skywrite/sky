import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { createAnthropic } from '@ai-sdk/anthropic'
import { generateObject, NoObjectGeneratedError } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { z } from 'zod'
import Document from '#shared/models/Markdown/Document/mod.ts'
import { assert, test } from '#test'
import { createVoiceIntelligence } from './intelligence.ts'
import { WritingVoiceStore } from './store.ts'
import { ExampleSchema, QuestionSchema } from './types.ts'

const example = ExampleSchema.parse({
  id: 'a'.repeat(32),
  source: 'settings',
  medium: 'Email',
  original: 'I wanted to let you know the Atlas draft is ready.',
  revised: 'The Atlas draft is ready.',
  created: '2025-03-15',
  updated: '2025-03-15',
})
const question = {
  before: 'I wanted to let you know',
  after: 'The Atlas draft is ready.',
  question: 'Why did you remove the introduction?',
  options: ['I prefer direct updates.', 'This recipient already has the context.'],
}

function hasUnsupportedArray(schema: unknown): boolean {
  if (!schema || typeof schema !== 'object') return false
  if (Array.isArray(schema)) return schema.some(hasUnsupportedArray)
  const value = schema as Record<string, unknown>
  if (Object.hasOwn(value, 'prefixItems')) return true
  if (value.type === 'array' && (!value.items || typeof value.items !== 'object' || Array.isArray(value.items)))
    return true
  return Object.values(value).some(hasUnsupportedArray)
}

test('Every writing-voice operation uses arrays accepted by the Anthropic structured-output endpoint', async () => {
  const rejected: boolean[] = []
  let response: unknown = question
  const schemaError = "Array types must be specified with a single object schema for 'items'."
  const provider = createAnthropic({
    apiKey: 'test-api-key',
    fetch: (async (_input, init) => {
      const request = JSON.parse(String(init?.body))
      const invalid = hasUnsupportedArray(request.output_config.format.schema)
      rejected.push(invalid)
      if (invalid)
        return Response.json(
          { type: 'error', error: { type: 'invalid_request_error', message: schemaError } },
          { status: 400 },
        )
      return Response.json({
        id: 'msg_synthetic',
        type: 'message',
        role: 'assistant',
        model: request.model,
        content: [{ type: 'text', text: JSON.stringify(response) }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 20 },
      })
    }) as typeof fetch,
  })
  const resolved = { model: provider('claude-fable-5-1'), maxRetries: 0 }
  let legacyError = ''
  try {
    await generateObject({
      ...resolved,
      schema: QuestionSchema.extend({ options: z.tuple([z.string(), z.string()]) }),
      prompt: 'Ask about the supplied writing example.',
    })
  } catch (error) {
    legacyError = (error as Error).message
  }
  assert({
    given: 'the actual provider adapter serializes the former tuple schema',
    should: 'reproduce the provider rejection before any question can be generated',
    actual: [rejected, legacyError],
    expected: [[true], schemaError],
  })

  const writer = createVoiceIntelligence(() => resolved)
  const generatedQuestion = await writer.question(example)
  const answered = { ...example, question: generatedQuestion, answer: question.options[0] }
  const lesson = { scope: 'Status updates', text: 'Open directly with the update.' }
  response = lesson
  const generatedLesson = await writer.learn(answered)
  const compaction = { lessons: [{ ...lesson, examples: [example.id] }], covered: [] }
  response = compaction
  const generatedCompaction = await writer.compact('', [{ ...answered, lesson: generatedLesson }])
  response = { draft: 'The Atlas draft is ready.' }
  const generatedDraft = await writer.draft({
    meaning: 'The Atlas draft is ready.',
    rules: '',
    lessons: [generatedLesson],
    examples: [answered],
  })
  assert({
    given: 'the production question, lesson, compaction, and draft schemas pass through the provider adapter',
    should: 'return usable results with two choices and no unsupported arrays, including nested compaction arrays',
    actual: [rejected, generatedQuestion, generatedLesson, generatedCompaction, generatedDraft],
    expected: [[true, false, false, false, false], question, lesson, compaction, 'The Atlas draft is ready.'],
  })
})

test('An invalid number of answer choices or an empty choice cannot enter a generated learning question', async () => {
  const options = [[], ['One choice'], ['One', 'Two', 'Three'], ['One', '   ']]
  for (const choices of options) {
    const model = new MockLanguageModelV4({
      doGenerate: {
        content: [{ type: 'text', text: JSON.stringify({ ...question, options: choices }) }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1, text: 1, reasoning: 0 },
        },
        warnings: [],
      },
    })
    let failure: unknown
    try {
      await createVoiceIntelligence(() => ({ model })).question(example)
    } catch (error) {
      failure = error
    }
    assert({
      given: `a model response with invalid choices: ${JSON.stringify(choices)}`,
      should: 'reject the response during SDK validation before offering it to the owner',
      actual: NoObjectGeneratedError.isInstance(failure),
      expected: true,
    })
  }
})

test('Previously saved writing examples with two answer choices remain readable', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-voice-schema-'))
  try {
    const store = new WritingVoiceStore(root, path.join(root, 'state'))
    const dir = path.join(store.dir, 'examples')
    await mkdir(dir, { recursive: true })
    const saved = { ...example, question, answer: question.options[1] }
    await writeFile(path.join(dir, `${example.id}.md`), new Document(saved, '# Writing example\n').toMarkdown())
    const loaded = await store.get(example.id)
    assert({
      given: 'an existing Markdown example containing the original two-element answer array',
      should: 'load both choices and the owner’s answer without migration',
      actual: [loaded?.question, loaded?.answer],
      expected: [question, question.options[1]],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('The voice model receives writing rules as instructions and only returns the structured draft', async () => {
  const model = new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: 'text', text: JSON.stringify({ draft: 'The draft is ready.' }) }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
      warnings: [],
    },
  })
  const writer = createVoiceIntelligence(() => ({ model }))
  const draft = await writer.draft({
    meaning: 'The draft is ready.',
    medium: 'Email',
    rules: 'Use a direct opening.',
    lessons: [],
    examples: [],
  })
  const call = model.doGenerateCalls[0]
  const system = call.prompt.find((message) => message.role === 'system')!
  const user = call.prompt.find((message) => message.role === 'user')!
  const input = JSON.parse(
    user.content
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join(''),
  )
  assert({
    given: 'the real structured model adapter with a scripted model',
    should: 'identify itself as Ghostwriter, apply the voice task and current rules, and expose no action tools',
    actual: [
      draft,
      system.content.includes('You are Ghostwriter,'),
      system.content.includes('writing voice'),
      input.rules,
      call.tools?.length ?? 0,
    ],
    expected: ['The draft is ready.', true, true, 'Use a direct opening.', 0],
  })
})
