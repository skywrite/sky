import { assert, test } from '#test'
import type { LanguageModelV4, LanguageModelV4CallOptions } from '@ai-sdk/provider'
import { wrapLanguageModel } from 'ai'
import { wellFormedPromptMiddleware } from './wellFormedPrompt.ts'

/** A leading surrogate with nothing after it — the shape a mid-emoji cut leaves behind. */
const ORPHAN_HIGH = '😀'.charAt(0)
const REPLACEMENT = '�'

/** Minimal call options; the middleware only reads `prompt`. */
function callOptions(prompt: LanguageModelV4CallOptions['prompt']): LanguageModelV4CallOptions {
  return { prompt } as LanguageModelV4CallOptions
}

const transform = (params: LanguageModelV4CallOptions) =>
  wellFormedPromptMiddleware.transformParams!({ type: 'generate', params, model: {} as never })

test('wellFormedPromptMiddleware', async (t) => {
  await t.step('repairs an orphan half in a user message', async () => {
    // The production path: ai:context:evolve sent a truncated turn ending in
    // half an emoji, and the API rejected the entire request body.
    const params = callOptions([
      { role: 'user', content: [{ type: 'text', text: `**Assistant:** draft the three lines${ORPHAN_HIGH}` }] },
    ])
    const out = await transform(params)

    assert({
      given: 'a prompt whose user text ends in half an emoji',
      should: 'replace the orphan before the request is built',
      actual: out.prompt,
      expected: [
        { role: 'user', content: [{ type: 'text', text: `**Assistant:** draft the three lines${REPLACEMENT}` }] },
      ],
    })
  })

  await t.step('repairs an orphan half in a tool result', async () => {
    const params = callOptions([
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call_1',
            toolName: 'web_fetch',
            output: { type: 'text', value: `page text${ORPHAN_HIGH}` },
          },
        ],
      },
    ])

    const out = await transform(params)

    assert({
      given: 'a truncated web_fetch result carrying an orphan half',
      should: 'repair it too — tool output is part of the same body',
      actual: JSON.stringify(out.prompt).includes(REPLACEMENT),
      expected: true,
    })
  })

  await t.step('passes a clean prompt through untouched', async () => {
    const params = callOptions([{ role: 'user', content: [{ type: 'text', text: 'ship it 😀' }] }])
    const out = await transform(params)

    assert({
      given: 'a prompt with only well-formed emoji',
      should: 'return the identical params object, not a copy',
      actual: out === params,
      expected: true,
    })
  })

  await t.step('intercepts through wrapLanguageModel, as the registry composes it', async () => {
    // Covers the wiring, not just the transform: languageModelFor wraps every
    // model this way, so what the provider receives is what this asserts.
    let received: LanguageModelV4CallOptions | undefined
    const model = wrapLanguageModel({
      model: {
        specificationVersion: 'v4',
        provider: 'test',
        modelId: 'test',
        supportedUrls: {},
        doGenerate: async (options: LanguageModelV4CallOptions) => {
          received = options
          return { content: [], finishReason: 'stop', usage: {}, warnings: [] }
        },
        doStream: async () => {
          throw new Error('not used')
        },
      } as unknown as LanguageModelV4,
      middleware: wellFormedPromptMiddleware,
    })

    await model.doGenerate(callOptions([{ role: 'user', content: [{ type: 'text', text: `turn${ORPHAN_HIGH}` }] }]))

    assert({
      given: 'a wrapped model called with a prompt carrying an orphan half',
      should: 'hand the provider a repaired prompt',
      actual: JSON.stringify(received?.prompt).includes(REPLACEMENT),
      expected: true,
    })
  })
})
