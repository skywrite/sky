import { createSecret } from '#lib/secrets/marshal.ts'
import { TestSecretsProvider } from '#lib/secrets/TestSecretsProvider.ts'
import { assert, test } from '#test'
import { findKey, forgetKey, hasKey, keychainAuthFetch } from './keychainAuthFetch.ts'

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

const ENV_SECRET = { category: 'atlas', name: 'main', env: 'ATLAS_API_KEY' } as const
const atlasEnv = (name: string) => (name === 'ATLAS_API_KEY' ? 'ak-env-key' : undefined)

test('a key the keychain lacks is read from its environment variable, and the keychain wins', async () => {
  const secrets = new TestSecretsProvider()
  assert({
    given: 'no atlas/main entry and ATLAS_API_KEY set',
    should: 'find the key in the environment',
    actual: await findKey(secrets, ENV_SECRET, atlasEnv),
    expected: { key: 'ak-env-key', source: 'env' },
  })

  await secrets.set('atlas', 'main', createSecret('ak-keychain-key'))
  assert({
    given: 'a keychain entry beside the environment variable',
    should: 'use the keychain’s key',
    actual: await findKey(secrets, ENV_SECRET, atlasEnv),
    expected: { key: 'ak-keychain-key', source: 'keychain' },
  })
  assert({
    given: 'neither a keychain entry nor the variable',
    should: 'find nothing',
    actual: await findKey(new TestSecretsProvider(), ENV_SECRET, () => undefined),
    expected: null,
  })
})

test('a key the index does not list never waits on the keychain', async () => {
  let reads = 0
  const counting = new Proxy(new TestSecretsProvider(), {
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

  const found = await findKey(counting, ENV_SECRET, atlasEnv)
  const present = await hasKey(counting, ENV_SECRET, () => undefined)
  assert({
    given: 'an index without atlas/main, as on a Mac whose keys live in src/.env',
    should: 'take the environment’s key without reading the keychain',
    actual: { source: found?.source, present, reads },
    expected: { source: 'env', present: false, reads: 0 },
  })
})

test('hasKey answers from the environment or the index', async () => {
  assert({
    given: 'the variable set',
    should: 'say there is a key',
    actual: await hasKey(new TestSecretsProvider(), ENV_SECRET, atlasEnv),
    expected: true,
  })
  assert({
    given: 'an index that lists atlas/main',
    should: 'say there is a key',
    actual: await hasKey(
      new TestSecretsProvider({ 'atlas/main': createSecret('ak-test-key') }),
      ENV_SECRET,
      () => undefined,
    ),
    expected: true,
  })
})

test('keychainAuthFetch signs an x-api-key provider in that header', async () => {
  const secrets = new TestSecretsProvider({ 'atlas/main': createSecret('ak-test-key') })
  const seen: Headers[] = []
  const base = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(new Headers(init?.headers))
    return new Response('{}', { status: 200 })
  }) as typeof fetch
  const signed = keychainAuthFetch(secrets, { category: 'atlas', name: 'main', header: 'x-api-key' }, MISSING, base)

  await signed(URL, { headers: { 'x-api-key': 'keychain' } })
  assert({
    given: 'a provider that reads x-api-key, and the SDK’s placeholder',
    should: 'put the keychain key there and send no bearer',
    actual: [seen[0]?.get('x-api-key'), seen[0]?.get('authorization')],
    expected: ['ak-test-key', null],
  })
})

test('a key stored or removed in Settings signs the next request', async () => {
  const secret = { category: 'atlas', name: 'forgotten' } as const
  const secrets = new TestSecretsProvider({ 'atlas/forgotten': createSecret('ak-old-key') })
  const recorder = recordingFetch()
  const signed = keychainAuthFetch(secrets, secret, MISSING, recorder.fetch)

  await signed(URL)
  await secrets.set('atlas', 'forgotten', createSecret('ak-new-key'))
  await signed(URL)
  forgetKey(secret)
  await signed(URL)
  assert({
    given: 'a key changed in the keychain, then forgotten',
    should: 'hold the old key until it is forgotten, then sign with the new one',
    actual: recorder.calls.map((call) => call.auth),
    expected: ['Bearer ak-old-key', 'Bearer ak-old-key', 'Bearer ak-new-key'],
  })
})
