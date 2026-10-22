import { createSecret } from '#lib/secrets/marshal.ts'
import { TestSecretsProvider } from '#lib/secrets/TestSecretsProvider.ts'
import type { SecretEntry } from '#lib/secrets/types.ts'
import { keychainAuthFetch } from '#shared/ai/keychainAuthFetch.ts'
import { ANTHROPIC_SECRET } from '#shared/ai/llm/anthropicProvider.ts'
import { assert, test } from '#test'
import { createProviderKeyRoutes, createProviderKeysHost } from './providerKeys.ts'

// The routes over a store in memory and a scripted provider: no keychain, no network, no real key.

const ACCEPTED = 'sk-atlas-accepted-key-7f3e'
const IN_ENV = 'sk-atlas-env-file-key-91b0'

function appWith({
  env = {},
  entries = {},
}: { env?: Record<string, string>; entries?: Record<string, SecretEntry> } = {}) {
  const secrets = new TestSecretsProvider(entries)
  const asked: string[] = []
  const host = createProviderKeysHost(secrets, {
    check: (id, key) => {
      asked.push(id)
      return Promise.resolve(
        key === ACCEPTED || key === IN_ENV
          ? { ok: true }
          : { ok: false, refused: true, message: `${id} refused the key.` },
      )
    },
    lookup: (name) => env[name],
  })
  return { app: createProviderKeyRoutes(host), secrets, asked }
}

const post = (app: ReturnType<typeof appWith>['app'], url: string, body: unknown) =>
  Promise.resolve(
    app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  )

test('a provider with no key anywhere reads as not set, without asking it', async () => {
  const { app, asked } = appWith()
  const answer = await app.request('/anthropic')
  assert({
    given: 'no keychain entry and nothing in src/.env',
    should: 'answer not set and leave the provider alone',
    actual: [answer.status, await answer.json(), asked],
    expected: [200, { source: null }, []],
  })
})

test('a key in src/.env reads as such, checked with the provider, and is never sent back whole', async () => {
  const { app, asked } = appWith({ env: { ANTHROPIC_API_KEY: IN_ENV } })
  const answer = await app.request('/anthropic')
  const text = await answer.text()
  assert({
    given: 'ANTHROPIC_API_KEY in src/.env',
    should: 'name the variable and show only the last four characters',
    actual: [JSON.parse(text), asked, text.includes(IN_ENV)],
    expected: [{ source: 'env', env: 'ANTHROPIC_API_KEY', tail: '91b0' }, ['anthropic'], false],
  })
})

test('a pasted key is checked first, stored only when accepted, and then wins over src/.env', async () => {
  const { app, secrets } = appWith({ env: { OPENAI_API_KEY: IN_ENV } })
  const blank = await post(app, '/openai', { key: '  ' })
  const refused = await post(app, '/openai', { key: 'sk-mistyped' })
  const afterRefusal = await secrets.get('openai', 'main')
  const saved = await post(app, '/openai', { key: ` ${ACCEPTED} ` })
  const stored = await secrets.get('openai', 'main')
  const status = await app.request('/openai')
  assert({
    given: 'a blank key, a refused key, then an accepted one',
    should: 'ask for the key, keep the refusal out, and store the accepted key trimmed',
    actual: [
      [blank.status, await blank.json()],
      [refused.status, await refused.json(), afterRefusal],
      [saved.status, stored?.type === 'secret' ? stored.val : null],
      await status.json(),
    ],
    expected: [
      [400, { message: 'Paste the API key from platform.openai.com.' }],
      [400, { message: 'openai refused the key.' }, null],
      [200, ACCEPTED],
      { source: 'keychain', tail: '7f3e' },
    ],
  })
})

test('saving a key signs the running process’s next request with it', async () => {
  const { app, secrets } = appWith({ entries: { 'anthropic/main': createSecret('sk-atlas-older-key-0001') } })
  const sent: Array<string | null> = []
  const base = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    sent.push(new Headers(init?.headers).get('x-api-key'))
    return new Response('{}')
  }) as typeof fetch
  const signed = keychainAuthFetch(secrets, ANTHROPIC_SECRET, 'missing', base)

  await signed('https://api.example.test/v1/messages')
  await post(app, '/anthropic', { key: ACCEPTED })
  await signed('https://api.example.test/v1/messages')
  assert({
    given: 'a key saved on the page while a provider already holds the old one',
    should: 'sign the next request with the new key, no restart',
    actual: sent,
    expected: ['sk-atlas-older-key-0001', ACCEPTED],
  })
})

test('removing takes the keychain’s key out and leaves src/.env’s in charge', async () => {
  const { app, secrets } = appWith({
    env: { ANTHROPIC_API_KEY: IN_ENV },
    entries: { 'anthropic/main': createSecret(ACCEPTED) },
  })
  const removed = await app.request('/anthropic', { method: 'DELETE' })
  const status = await app.request('/anthropic')
  assert({
    given: 'a keychain key beside one in src/.env',
    should: 'delete the keychain entry and read the src/.env key again',
    actual: [removed.status, await secrets.get('anthropic', 'main'), await status.json()],
    expected: [200, null, { source: 'env', env: 'ANTHROPIC_API_KEY', tail: '91b0' }],
  })
})

test('a stored key the provider turns away reads as refused', async () => {
  const { app } = appWith({ entries: { 'cerebras/main': createSecret('csk-atlas-revoked-key-0000') } })
  const answer = await app.request('/cerebras')
  assert({
    given: 'a Cerebras key revoked since it was saved',
    should: 'say refused, with the provider’s words',
    actual: await answer.json(),
    expected: { source: 'keychain', tail: '0000', refused: true, error: 'cerebras refused the key.' },
  })
})

test('a provider Sky keeps no key for is a 404', async () => {
  const { app } = appWith()
  const answer = await app.request('/mistral')
  assert({
    given: 'a provider outside Services',
    should: 'refuse in plain words',
    actual: [answer.status, await answer.json()],
    expected: [404, { message: 'Sky keeps no API key for “mistral”.' }],
  })
})
