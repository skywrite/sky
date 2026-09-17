import { createSecret } from '#lib/secrets/marshal.ts'
import { TestSecretsProvider } from '#lib/secrets/TestSecretsProvider.ts'
import { assert, test } from '#test'
import { keychainAuthFetch } from './keychainAuthFetch.ts'

const SECRET = { category: 'atlas', name: 'main' } as const
const MISSING = 'No Atlas key in the keychain — run `sky secrets:set atlas main`.'
const URL = 'https://api.example.test/v1/models'

function recordingFetch(): { calls: { url: string; auth: string | null }[]; fetch: typeof fetch } {
  const calls: { url: string; auth: string | null }[] = []
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), auth: new Headers(init?.headers).get('authorization') })
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  return { calls, fetch: fetchFn }
}

test('keychainAuthFetch signs requests with the keychain key', async () => {
  const secrets = new TestSecretsProvider({ 'atlas/main': createSecret('ak-test-key') })
  const recorder = recordingFetch()
  const signed = keychainAuthFetch(secrets, SECRET, MISSING, recorder.fetch)

  await signed(URL, { headers: { authorization: 'Bearer placeholder' } })
  assert({
    given: "a request carrying an SDK's placeholder key",
    should: 'replace it with the keychain key',
    actual: recorder.calls[0].auth,
    expected: 'Bearer ak-test-key',
  })
})

test('keychainAuthFetch reads the keychain once per process', async () => {
  let reads = 0
  const secrets = new TestSecretsProvider({ 'atlas/main': createSecret('ak-test-key') })
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
  const signed = keychainAuthFetch(counting, SECRET, MISSING, recorder.fetch)

  await signed(URL)
  await signed(URL)
  assert({ given: 'two sequential requests', should: 'read the keychain once', actual: reads, expected: 1 })
})

test('a missing key fails with the fix and is not remembered', async () => {
  const secrets = new TestSecretsProvider()
  const recorder = recordingFetch()
  const signed = keychainAuthFetch(secrets, SECRET, MISSING, recorder.fetch)

  let message = ''
  try {
    await signed(URL)
  } catch (err) {
    message = (err as Error).message
  }
  assert({
    given: 'no atlas/main entry in the keychain',
    should: 'fail with the words that say where the key goes',
    actual: message,
    expected: MISSING,
  })
  assert({ given: 'the failed request', should: 'never reach the network', actual: recorder.calls.length, expected: 0 })

  await secrets.set('atlas', 'main', createSecret('ak-late-key'))
  await signed(URL)
  assert({
    given: 'the key stored after the failure',
    should: 'sign the next request without a restart',
    actual: recorder.calls[0].auth,
    expected: 'Bearer ak-late-key',
  })
})
