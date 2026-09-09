import { MockLanguageModelV4 } from 'ai/test'
import { assert, test } from '#test'
import { createVoiceIntelligence } from './intelligence.ts'

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
    should: 'apply the voice task, supply the current rules, and expose no action tools',
    actual: [draft, system.content.includes('writing voice'), input.rules, call.tools?.length ?? 0],
    expected: ['The draft is ready.', true, 'Use a direct opening.', 0],
  })
})
