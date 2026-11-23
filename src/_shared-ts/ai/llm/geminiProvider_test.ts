import { generateText } from 'ai'
import { createSecret } from '#lib/secrets/marshal.ts'
import { TestSecretsProvider } from '#lib/secrets/TestSecretsProvider.ts'
import { assert, test } from '#test'
import { aiModelByProfile, getProfile, resolveProfile } from '../models.ts'
import { createGeminiProvider, GEMINI_BASE_URL } from './geminiProvider.ts'

test('createGeminiProvider signs requests with x-goog-api-key and serializes Gemini 4 thinkingLevel', async () => {
  const secrets = new TestSecretsProvider({ 'gemini/main': createSecret('gm-atlas-test-key') })
  const calls: Array<{ url: string; key: string | null; auth: string | null; thinkingLevel: unknown }> = []
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    const body = JSON.parse(String(init?.body)) as {
      generationConfig?: { thinkingConfig?: { thinkingLevel?: unknown } }
    }
    calls.push({
      url: String(input),
      key: headers.get('x-goog-api-key'),
      auth: headers.get('authorization'),
      thinkingLevel: body.generationConfig?.thinkingConfig?.thinkingLevel,
    })
    return Response.json({
      candidates: [
        {
          content: { role: 'model', parts: [{ text: 'Atlas is ready.' }] },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 5, totalTokenCount: 17 },
    })
  }) as typeof fetch

  const provider = createGeminiProvider({ secrets, fetch: fetchFn })
  const model = provider('gemini-4-neon')

  assert({
    given: 'a Gemini model',
    should: 'carry the requested id',
    actual: model.modelId,
    expected: 'gemini-4-neon',
  })
  assert({ given: 'a Gemini model', should: 'name its provider gemini', actual: model.provider, expected: 'gemini' })

  const profile = getProfile('default-gemini-4-neon', { models: { strong: '', fast: '', transcription: '' } })
  const high = await generateText({
    ...resolveProfile(profile, { temperature: 0 }),
    model,
    maxRetries: 0,
    prompt: 'Ping Atlas.',
  })
  const xhigh = await generateText({
    ...resolveProfile(profile, { effort: 'xhigh', temperature: 0 }),
    model,
    maxRetries: 0,
    prompt: 'Ping Atlas deeply.',
  })

  assert({
    given: 'default-gemini-4-neon at default high and overridden to xhigh through the installed Google adapter',
    should: 'hit the Gemini endpoint, replace the placeholder x-goog-api-key, and send each thinkingLevel',
    actual: { calls, texts: [high.text, xhigh.text] },
    expected: {
      calls: [
        {
          url: `${GEMINI_BASE_URL}/models/gemini-4-neon:generateContent`,
          key: 'gm-atlas-test-key',
          auth: null,
          thinkingLevel: 'high',
        },
        {
          url: `${GEMINI_BASE_URL}/models/gemini-4-neon:generateContent`,
          key: 'gm-atlas-test-key',
          auth: null,
          thinkingLevel: 'xhigh',
        },
      ],
      texts: ['Atlas is ready.', 'Atlas is ready.'],
    },
  })
})

test('default-gemini-4-neon resolves under providerOptions.google with its 1M window', () => {
  const resolved = aiModelByProfile('default-gemini-4-neon')
  assert({
    given: 'the default-gemini-4-neon profile',
    should: 'resolve to gemini-4-neon with its 1,048,576-token window and google thinkingConfig',
    actual: [(resolved.model as { modelId: string }).modelId, resolved.contextWindow, resolved.providerOptions],
    expected: ['gemini-4-neon', 1_048_576, { google: { thinkingConfig: { thinkingLevel: 'high' } } }],
  })
})
