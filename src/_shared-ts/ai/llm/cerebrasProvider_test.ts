import { createSecret } from '#lib/secrets/marshal.ts'
import { TestSecretsProvider } from '#lib/secrets/TestSecretsProvider.ts'
import { assert, test } from '#test'
import { aiModelByProfile } from '../models.ts'
import {
  CEREBRAS_BASE_URL,
  createCerebrasProvider,
  keychainAuthFetch,
  MISSING_CEREBRAS_KEY,
} from './cerebrasProvider.ts'

function recordingFetch(): { calls: { url: string; auth: string | null }[]; fetch: typeof fetch } {
  const calls: { url: string; auth: string | null }[] = []
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), auth: new Headers(init?.headers).get('authorization') })
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  return { calls, fetch: fetchFn }
}

test('keychainAuthFetch signs requests with the keychain key', async () => {
  const secrets = new TestSecretsProvider({ 'cerebras/main': createSecret('csk-test-key') })
  const recorder = recordingFetch()
  const signed = keychainAuthFetch(secrets, recorder.fetch)

  await signed('https://api.cerebras.ai/v1/chat/completions', { headers: { authorization: 'Bearer keychain' } })
  assert({
    given: 'a request carrying the SDK placeholder key',
    should: 'replace it with the keychain key',
    actual: recorder.calls[0].auth,
    expected: 'Bearer csk-test-key',
  })
})

test('keychainAuthFetch reads the keychain once per process', async () => {
  let reads = 0
  const secrets = new TestSecretsProvider({ 'cerebras/main': createSecret('csk-test-key') })
  const counting = new Proxy(secrets, {
    get(target, prop, receiver) {
      if (prop === 'get') {
        return (...args: [string, string]) => {
          reads++
          return target.get(...args)
        }
      }
      return Reflect.get(target, prop, receiver)
    },
  })
  const recorder = recordingFetch()
  const signed = keychainAuthFetch(counting, recorder.fetch)

  await signed('https://api.cerebras.ai/v1/chat/completions')
  await signed('https://api.cerebras.ai/v1/chat/completions')
  assert({ given: 'two sequential requests', should: 'read the keychain once', actual: reads, expected: 1 })
})

test('a missing key fails with the fix and is not remembered', async () => {
  const secrets = new TestSecretsProvider()
  const recorder = recordingFetch()
  const signed = keychainAuthFetch(secrets, recorder.fetch)

  let message = ''
  try {
    await signed('https://api.cerebras.ai/v1/chat/completions')
  } catch (err) {
    message = (err as Error).message
  }
  assert({
    given: 'no cerebras/main entry in the keychain',
    should: 'fail naming the secrets:set command',
    actual: message,
    expected: MISSING_CEREBRAS_KEY,
  })
  assert({ given: 'the failed request', should: 'never reach the network', actual: recorder.calls.length, expected: 0 })

  await secrets.set('cerebras', 'main', createSecret('csk-late-key'))
  await signed('https://api.cerebras.ai/v1/chat/completions')
  assert({
    given: 'the key stored after the failure',
    should: 'sign the next request without a restart',
    actual: recorder.calls[0].auth,
    expected: 'Bearer csk-late-key',
  })
})

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
