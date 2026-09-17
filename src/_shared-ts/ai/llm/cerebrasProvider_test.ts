import { createSecret } from '#lib/secrets/marshal.ts'
import { TestSecretsProvider } from '#lib/secrets/TestSecretsProvider.ts'
import { assert, test } from '#test'
import { aiModelByProfile } from '../models.ts'
import { CEREBRAS_BASE_URL, createCerebrasProvider } from './cerebrasProvider.ts'

function recordingFetch(): { calls: { url: string; auth: string | null }[]; fetch: typeof fetch } {
  const calls: { url: string; auth: string | null }[] = []
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), auth: new Headers(init?.headers).get('authorization') })
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  return { calls, fetch: fetchFn }
}

test('createCerebrasProvider builds chat models against the Cerebras host', async () => {
  const secrets = new TestSecretsProvider({ 'cerebras/main': createSecret('csk-test-key') })
  const recorder = recordingFetch()
  const provider = createCerebrasProvider({ secrets, fetch: recorder.fetch })
  const model = provider.chat('qwen-3.8-27b')

  assert({ given: 'a chat model', should: 'carry the requested id', actual: model.modelId, expected: 'qwen-3.8-27b' })
  assert({
    given: 'a chat model',
    should: 'name its provider cerebras',
    actual: model.provider,
    expected: 'cerebras.chat',
  })

  try {
    await model.doGenerate({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] })
  } catch {
    // The recorder answers `{}`; the SDK's response parsing fails after the request was made.
  }
  assert({
    given: 'a generate call',
    should: 'hit the chat-completions endpoint on the Cerebras host',
    actual: recorder.calls[0]?.url,
    expected: `${CEREBRAS_BASE_URL}/chat/completions`,
  })
})

test('the default Cerebras profile resolves to Qwen with reasoning on', () => {
  const resolved = aiModelByProfile('default-cerebras-qwen-3.8')
  assert({
    given: 'the default-cerebras-qwen-3.8 profile',
    should: 'resolve to the qwen-3.8-27b model',
    actual: (resolved.model as { modelId: string }).modelId,
    expected: 'qwen-3.8-27b',
  })
  assert({
    given: 'the default-cerebras-qwen-3.8 profile',
    should: 'namespace its options where the OpenAI chat model reads them',
    actual: resolved.providerOptions,
    expected: { openai: { reasoningEffort: 'high' } },
  })
})
