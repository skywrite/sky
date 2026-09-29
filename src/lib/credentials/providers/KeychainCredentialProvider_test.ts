import { mkdtemp, rm } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { KeychainAccessError } from '#lib/secrets/keychainProtocol.ts'
import { TestSecretsProvider } from '#lib/secrets/TestSecretsProvider.ts'
import type { SecretEntry } from '#lib/secrets/types.ts'
import { assert, test } from '#test'
import { Instant } from '#universal/dates/nbdt/mod.ts'
import type { CredentialDraft } from '../types.ts'
import { KeychainCredentialProvider } from './KeychainCredentialProvider.ts'

const now = '2026-01-02T03:04:05.000Z'
const draft: CredentialDraft = {
  containerId: 'credentials',
  title: 'Widget API',
  nativeCategory: 'API Credentials',
  fields: [{ id: 'key', label: 'Key', kind: 'secret', value: 'mock-api-key' }],
  websites: [{ url: 'https://example.com', match: 'exact' }],
}

async function fixture(
  work: (store: TestSecretsProvider, provider: KeychainCredentialProvider, lock: string) => Promise<void>,
) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sky-credentials-test-'))
  const store = new TestSecretsProvider()
  const lock = path.join(dir, 'lock')
  try {
    await work(store, new KeychainCredentialProvider('local', store, lock, 'Keychain', () => now), lock)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('keychain adapter reads and updates legacy logins without changing their format', async () =>
  fixture(async (store, provider) => {
    const entry: SecretEntry = {
      schema: '1.0.0',
      created: now,
      updated: now,
      type: 'login',
      user: 'jane@example.com',
      pass: 'mock-password',
      notes: 'Keep this note',
    }
    await store.set('widget', 'personal', entry)
    const { items } = await provider.list()
    const item = await provider.inspect(items[0].ref)
    const values = await provider.readFields(item.ref, [{ id: 'username' }, { id: 'password' }])
    const changed = await provider.updateFields(
      item.ref,
      [{ id: 'password', value: 'mock-new-password' }],
      item.revision,
    )
    const saved = await store.get('widget', 'personal')
    assert({
      given: 'an existing Sky login',
      should: 'preserve legacy fields, notes and identity',
      actual: [
        values.map((field) => field.value.use((value) => value)),
        saved?.type,
        saved?.notes,
        saved?.type === 'login' ? [saved.user, saved.pass] : null,
        changed.ref,
        changed.revision !== item.revision,
      ],
      expected: [
        ['jane@example.com', 'mock-password'],
        'login',
        'Keep this note',
        ['jane@example.com', 'mock-new-password'],
        item.ref,
        true,
      ],
    })
    assert({
      given: 'metadata and read results',
      should: 'redact secret values from serialization',
      actual: JSON.stringify([items, item, values, changed]).includes('mock-password'),
      expected: false,
    })
    const stale = await provider
      .updateFields(item.ref, [{ id: 'password', value: 'stale' }], item.revision)
      .catch((error) => error.code)
    assert({ given: 'an old revision', should: 'reject the overwrite', actual: stale, expected: 'conflict' })
  }))

test('legacy raw secrets can be updated despite fresh wrapper timestamps on each read', async () =>
  fixture(async (store, provider) => {
    await store.set('widget', 'api', {
      schema: '1.0.0',
      type: 'secret',
      created: now,
      updated: now,
      val: 'mock-legacy-key',
    })
    const get = store.get.bind(store)
    let reads = 0
    store.get = async (category, name) => {
      const entry = await get(category, name)
      const timestamp = Instant.from(now).add({ seconds: ++reads }).toString()
      return entry ? { ...entry, created: timestamp, updated: timestamp } : null
    }
    const ref = { connectionId: 'local', containerId: 'widget', itemId: 'api' }
    const first = await provider.inspect(ref)
    const second = await provider.inspect(ref)
    const changed = await provider.updateFields(ref, [{ id: 'value', value: 'mock-rotated-key' }], first.revision)
    const staleDelete = await provider.delete(ref, first.revision).catch((error) => error.code)
    const saved = await get('widget', 'api')
    assert({
      given: 'unchanged content with newly synthesized timestamps',
      should: 'allow the edit and reject a stale delete after the content changes',
      actual: [
        first.revision === second.revision,
        changed.revision !== first.revision,
        staleDelete,
        saved?.type === 'secret' ? saved.val : null,
      ],
      expected: [true, true, 'conflict', 'mock-rotated-key'],
    })
  }))

test('new keychain records support multiple fields and allocate colliding names under one lock', async () =>
  fixture(async (store, provider, lock) => {
    const second = new KeychainCredentialProvider('local', store, lock, 'Keychain', () => now)
    const [one, two] = await Promise.all([provider.create(draft), second.create({ ...draft, title: 'widget api' })])
    assert({
      given: 'two case-insensitively identical names at the same second',
      should: 'allocate distinct readable IDs',
      actual: [one.ref.itemId, two.ref.itemId].map((id) => id.toLowerCase()).sort(),
      expected: ['2026-01-02_030405_widget-api', '2026-01-02_030405_widget-api-2'],
    })
    assert({
      given: 'new encrypted records',
      should: 'list their metadata without exposing values',
      actual: (await provider.list()).items.map((item) => [item.title, item.nativeCategory]).sort(),
      expected: [
        ['Widget API', 'API Credentials'],
        ['widget api', 'API Credentials'],
      ],
    })
    const updated = await provider.updateFields(one.ref, [{ id: 'key', value: 'rotated-mock-key' }], one.revision)
    const read = await provider.readFields(one.ref, [{ id: 'key' }])
    assert({
      given: 'a selected field update',
      should: 'keep the reference stable',
      actual: [updated.ref, read[0].value.use((v) => v)],
      expected: [one.ref, 'rotated-mock-key'],
    })
    await provider.delete(one.ref, updated.revision)
    assert({
      given: 'deleting one record',
      should: 'keep the other',
      actual: (await provider.list()).items.length,
      expected: 1,
    })
  }))

test('keychain OTP is an explicit operation over a stored setup URI', async () =>
  fixture(async (_store, provider) => {
    const item = await provider.create({
      ...draft,
      fields: [
        {
          id: 'otp',
          kind: 'secret',
          role: 'otp',
          label: 'Authenticator',
          value: 'otpauth://totp/Example?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
        },
      ],
    })
    const otp = await provider.getOtp({ item: item.ref, id: 'otp' })
    assert({
      given: 'an explicit OTP request',
      should: 'return a concealed code with expiry',
      actual: [otp.code.use((code) => /^\d{6}$/.test(code)), otp.expiresAt, JSON.stringify(otp).includes('[redacted]')],
      expected: [true, '2026-01-02T03:04:30Z', true],
    })
  }))

test('keychain access failures and wrong connections cannot become missing credentials', async () =>
  fixture(async (store, provider) => {
    store.get = async () => {
      throw new KeychainAccessError('access')
    }
    const ref = { connectionId: 'local', containerId: 'widget', itemId: 'personal' }
    const access = await provider.inspect(ref).catch((error) => error.code)
    const wrong = await provider.inspect({ ...ref, connectionId: 'other' }).catch((error) => error.code)
    assert({
      given: 'a locked store and an unrelated connection reference',
      should: 'report distinct errors',
      actual: [access, wrong],
      expected: ['access-required', 'invalid-input'],
    })
  }))
