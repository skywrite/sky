import type { LanguageModelV4CallOptions } from '@ai-sdk/provider'
import { assert, test } from '#test'
import { singleSystemMessageMiddleware } from './singleSystemMessage.ts'

function callOptions(prompt: LanguageModelV4CallOptions['prompt']): LanguageModelV4CallOptions {
  return { prompt } as LanguageModelV4CallOptions
}

const transform = (params: LanguageModelV4CallOptions) =>
  singleSystemMessageMiddleware.transformParams!({ type: 'stream', params, model: {} as never })

const user = { role: 'user' as const, content: [{ type: 'text' as const, text: 'Mission: go' }] }

test('singleSystemMessageMiddleware', async (t) => {
  await t.step('folds cache-split instructions into one leading system message', async () => {
    // cachedInstructions([a, b]) yields two system messages, each with an
    // Anthropic breakpoint; Cerebras 400s on the second one.
    const out = await transform(
      callOptions([
        { role: 'system', content: 'Rules.', providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } },
        {
          role: 'system',
          content: 'Slide design.',
          providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
        },
        user,
      ]),
    )
    assert({
      given: 'two system messages ahead of the user turn',
      should: 'send one system message holding both, then the user turn',
      actual: out.prompt,
      expected: [{ role: 'system', content: 'Rules.\n\nSlide design.' }, user],
    })
  })

  await t.step('moves a stray system message to the front', async () => {
    const out = await transform(callOptions([user, { role: 'system', content: 'Late rules.' }]))
    assert({
      given: 'a system message after the user turn',
      should: 'put it first',
      actual: out.prompt.map((m) => m.role),
      expected: ['system', 'user'],
    })
  })

  await t.step('passes a compliant prompt through untouched', async () => {
    const params = callOptions([{ role: 'system', content: 'Rules.' }, user])
    const out = await transform(params)
    assert({
      given: 'one system message already first',
      should: 'return the same params',
      actual: out === params,
      expected: true,
    })
  })

  await t.step('passes a prompt with no system message through untouched', async () => {
    const params = callOptions([user])
    const out = await transform(params)
    assert({ given: 'no system message', should: 'return the same params', actual: out === params, expected: true })
  })
})
