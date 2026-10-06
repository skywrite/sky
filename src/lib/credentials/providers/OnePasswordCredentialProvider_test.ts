import { setTimeout as delay } from 'node:timers/promises'
import { AutofillBehavior, type Item, type ItemOverview, type VaultOverview } from '@1password/sdk'
import { assert, test } from '#test'
import { matchesLoginOrigin } from '../login.ts'
import { onePasswordRequest } from '../onePasswordRequest.ts'
import { OnePasswordCredentialProvider } from './OnePasswordCredentialProvider.ts'
import type { OnePasswordClient } from './OnePasswordCredentialProvider.ts'

function nativeItem(vaultId = 'vault-a'): Item {
  // SDK dates are intentionally absent: they are not part of Sky's metadata projection.
  return {
    id: 'item-1',
    vaultId,
    title: 'Widget',
    category: 'Login',
    version: 1,
    tags: ['testing'],
    sections: [{ id: 'extra', title: 'Extra' }],
    files: [],
    notes: 'Keep this note',
    websites: [{ url: 'https://example.com', label: 'Site', autofillBehavior: 'ExactDomain' }],
    fields: [
      { id: 'username', title: 'Username', fieldType: 'Text', value: 'jane@example.com' },
      { id: 'password', title: 'Password', fieldType: 'Concealed', value: 'mock-password' },
      {
        id: 'code',
        sectionId: 'extra',
        title: 'Authenticator',
        fieldType: 'Totp',
        value: 'mock-seed',
        details: { type: 'Otp', content: { code: '123456' } },
      },
      {
        id: 'password',
        sectionId: 'extra',
        title: 'Other password',
        fieldType: 'Concealed',
        value: 'mock-other-password',
      },
      { id: 'future', title: 'Future field', fieldType: 'Unsupported', value: 'mock-opaque-field' },
    ],
  } as unknown as Item
}

function fixture(options: { id?: string; excludedVaultIds?: string[]; failVault?: string } = {}) {
  const stored = new Map(['vault-a', 'vault-b'].map((vault) => [vault, nativeItem(vault)]))
  let reads = 0
  let writes = 0
  const listed: string[] = []
  const client: OnePasswordClient = {
    vaults: { list: async () => ['vault-a', 'vault-b'].map((id) => ({ id, title: id }) as VaultOverview) },
    items: {
      list: async (vault) => {
        listed.push(vault)
        if (vault === options.failVault) throw new Error('failed with mock-sensitive-error-text')
        return [{ ...structuredClone(stored.get(vault)!), state: 'active' } as ItemOverview]
      },
      get: async (vault) => {
        reads++
        return structuredClone(stored.get(vault)!)
      },
      put: async (item) => {
        writes++
        const saved = { ...item, version: item.version + 1 }
        stored.set(item.vaultId, saved)
        return saved
      },
      create: async (params) => {
        writes++
        const saved = {
          ...nativeItem(params.vaultId),
          ...params,
          tags: params.tags ?? [],
          websites: params.websites ?? [],
          id: 'provider-allocated-id',
        } as Item
        stored.set(params.vaultId, saved)
        return saved
      },
      delete: async (vault) => {
        writes++
        stored.delete(vault)
      },
    },
  }
  const provider = new OnePasswordCredentialProvider(client, { id: 'personal', ...options })
  const ref = { connectionId: provider.connection.id, containerId: 'vault-a', itemId: 'item-1' }
  return { provider, client, stored, ref, listed, counts: () => ({ reads, writes }) }
}

test('desktop SDK operations cannot overlap across accounts, reads, writes or authorization', async () => {
  const a = fixture({ id: 'account-a' })
  const b = fixture({ id: 'account-b' })
  const c = fixture({ id: 'account-c' })
  let active = 0
  let peak = 0
  const calls = new Set<string>()
  const wrap =
    <Args extends unknown[], Result>(name: string, operation: (...args: Args) => Promise<Result>) =>
    async (...args: Args): Promise<Result> => {
      active++
      peak = Math.max(peak, active)
      calls.add(name)
      try {
        if (active > 1) throw new Error('IPC operation failed: -4')
        await delay(1)
        return await operation(...args)
      } finally {
        active--
      }
    }
  for (const { client } of [a, b, c]) {
    client.vaults.list = wrap('vaults', client.vaults.list)
    client.items.list = wrap('list', client.items.list)
    client.items.get = wrap('get', client.items.get)
    client.items.create = wrap('create', client.items.create)
    client.items.put = wrap('put', client.items.put)
    client.items.delete = wrap('delete', client.items.delete)
  }
  const [first, second] = await Promise.all([
    a.provider.list(),
    b.provider.list(),
    a.provider.inspect(a.ref),
    b.provider.readFields(b.ref, [{ id: 'password' }]),
    a.provider.getOtp({ item: a.ref, id: 'code', sectionId: 'extra' }),
    b.provider.create({
      containerId: 'vault-b',
      title: 'Sample key',
      nativeCategory: 'SecureNote',
      fields: [{ id: 'value', label: 'Value', kind: 'secret', value: 'mock-key' }],
    }),
    a.provider.updateFields(a.ref, [{ id: 'password', value: 'mock-rotated' }], '1'),
    c.provider.delete(c.ref, '1'),
    onePasswordRequest(wrap('authorize', async () => {})),
  ])
  assert({
    given: 'overlapping page loads, explicit secret actions and another account authorization',
    should: 'keep every desktop exchange exclusive without losing either item listing',
    actual: [
      peak,
      first.issues.length,
      second.issues.length,
      first.items.length,
      second.items.length,
      [...calls].sort(),
    ],
    expected: [1, 0, 0, 2, 2, ['authorize', 'create', 'delete', 'get', 'list', 'put', 'vaults']],
  })
  await onePasswordRequest(async () => {
    throw new Error('mock-rejected-authorization')
  }).catch(() => {})
  const recovered = await b.provider.list()
  assert({
    given: 'a rejected native operation followed by another account request',
    should: 'release the queue and permit the next operation',
    actual: [peak, active, recovered.items.length, recovered.issues.length],
    expected: [1, 0, 2, 0],
  })
})

test('1Password searches every accessible vault by default, retaining distinct references', async () => {
  const { provider, listed, counts } = fixture()
  const result = await provider.list()
  assert({
    given: 'two vaults with identically named items',
    should: 'list both without reading their secret bodies',
    actual: [listed, result.items.map((item) => item.ref), counts()],
    expected: [
      ['vault-a', 'vault-b'],
      [
        { connectionId: 'personal', containerId: 'vault-a', itemId: 'item-1' },
        { connectionId: 'personal', containerId: 'vault-b', itemId: 'item-1' },
      ],
      { reads: 0, writes: 0 },
    ],
  })
  assert({
    given: 'native responses containing more data than needed',
    should: 'project metadata only',
    actual: JSON.stringify(result).includes('mock-password'),
    expected: false,
  })
})

test('1Password exclusions apply to direct reads and writes as well as discovery', async () => {
  const { provider, ref, counts } = fixture({ excludedVaultIds: ['vault-a'] })
  const result = await provider.list()
  const outcomes = await Promise.all(
    [
      provider.inspect(ref),
      provider.readFields(ref, [{ id: 'password' }]),
      provider.updateFields(ref, [{ id: 'password', value: 'mock-new' }], '1'),
      provider.delete(ref, '1'),
      provider.getOtp({ item: ref, id: 'code', sectionId: 'extra' }),
      provider.create({
        containerId: 'vault-a',
        title: 'Widget',
        nativeCategory: 'Login',
        fields: [{ id: 'password', label: 'Password', kind: 'secret', value: 'mock-new' }],
      }),
    ].map((operation) => operation.catch((error) => error.code)),
  )
  assert({
    given: 'a reference into an excluded vault',
    should: 'reject every operation before accessing it',
    actual: [result.items.map((item) => item.ref.containerId), outcomes, counts()],
    expected: [['vault-b'], Array(6).fill('excluded'), { reads: 0, writes: 0 }],
  })
})

test('a failed 1Password vault remains an issue beside successful results', async () => {
  const { provider } = fixture({ failVault: 'vault-a' })
  const result = await provider.list()
  assert({
    given: 'one unavailable vault',
    should: 'retain other items and return sanitized error information',
    actual: [
      result.items.length,
      result.issues[0].containerId,
      result.issues[0].error.code,
      JSON.stringify(result).includes('mock-sensitive-error-text'),
    ],
    expected: [1, 'vault-a', 'unavailable', false],
  })
})

test('1Password field updates preserve the full native item and reject stale revisions', async () => {
  const { provider, ref, stored, counts } = fixture()
  Object.assign(stored.get('vault-a')!, { futureNativeMetadata: { keep: 'opaque' } })
  const item = await provider.inspect(ref)
  const updated = await provider.updateFields(ref, [{ id: 'password', value: 'mock-new-password' }], item.revision)
  const saved = stored.get('vault-a')!
  const stale = await provider
    .updateFields(ref, [{ id: 'password', value: 'stale' }], item.revision)
    .catch((error) => error.code)
  const unsupported = await provider
    .updateFields(ref, [{ id: 'future', value: 'overwrite' }], updated.revision)
    .catch((error) => error.code)
  assert({
    given: 'one password change in a rich native item',
    should: 'preserve other fields, sections, opaque data and the original reference',
    actual: [
      updated.ref,
      saved.fields.map((field) => field.value),
      saved.notes,
      saved.sections,
      (saved as Item & { futureNativeMetadata: unknown }).futureNativeMetadata,
      stale,
      unsupported,
      counts().writes,
    ],
    expected: [
      ref,
      ['jane@example.com', 'mock-new-password', 'mock-seed', 'mock-other-password', 'mock-opaque-field'],
      'Keep this note',
      [{ id: 'extra', title: 'Extra' }],
      { keep: 'opaque' },
      'conflict',
      'unsupported',
      1,
    ],
  })
  assert({
    given: 'an inspected native item',
    should: 'omit field values and computed OTP details',
    actual: JSON.stringify(item).includes('123456'),
    expected: false,
  })
})

test('1Password resolves exact fields and exposes OTP only through its separate operation', async () => {
  const { provider, ref } = fixture()
  const values = await provider.readFields(ref, [{ id: 'password', sectionId: 'extra' }])
  const otp = await provider.getOtp({ item: ref, id: 'code', sectionId: 'extra' })
  const missing = await provider.readFields(ref, [{ id: 'code' }]).catch((error) => error.code)
  assert({
    given: 'same-name fields in different sections and an authenticator',
    should: 'honor field identities and avoid inventing OTP expiry',
    actual: [values[0].value.use((v) => v), otp.code.use((v) => v), otp.expiresAt, missing],
    expected: ['mock-other-password', '123456', undefined, 'not-found'],
  })
})

test('login verification binds a fresh code to the approved item revision, origin, and field', async () => {
  const { provider, ref, stored } = fixture()
  const login = await provider.readLogin(ref, 'https://example.com')
  if (!login.otp) throw new Error('Missing authenticator binding')
  const item = stored.get('vault-a')!
  const field = item.fields.find((field) => field.fieldType === 'Totp')!
  field.details = { type: 'Otp', content: { code: '654321' } } as typeof field.details
  const code = await provider.readLoginOtp(ref, 'https://example.com', login.otp)
  const wrongOrigin = await provider.readLoginOtp(ref, 'https://other.example', login.otp).catch((e) => e.code)
  item.version++
  const edited = await provider.readLoginOtp(ref, 'https://example.com', login.otp).catch((e) => e.code)
  item.version--
  field.id = 'different-authenticator'
  const replaced = await provider.readLoginOtp(ref, 'https://example.com', login.otp).catch((e) => e.code)
  provider.setExcludedVaultIds(['vault-a'])
  const excluded = await provider.readLoginOtp(ref, 'https://example.com', login.otp).catch((e) => e.code)
  assert({
    given: 'a saved authenticator and changes after password approval',
    should: 'fetch a fresh code without a seed, expiry guess, or fallback to changed items',
    actual: [
      code.code.use((value) => value),
      code.expiresAt,
      wrongOrigin,
      edited,
      replaced,
      excluded,
      JSON.stringify([login, code]).includes('654321'),
      JSON.stringify(login).includes('mock-seed'),
    ],
    expected: ['654321', undefined, 'invalid-input', 'conflict', 'unsupported', 'excluded', false, false],
  })
})

test('login API permission comes from the same fresh native revision as the password', async () => {
  const { provider, ref, stored } = fixture()
  const exact = await provider.readLogin(ref, 'https://example.com')
  stored.get('vault-a')!.websites[0].autofillBehavior = AutofillBehavior.AnywhereOnWebsite
  const website = await provider.readLogin(ref, 'https://example.com')
  stored.get('vault-a')!.websites[0].autofillBehavior = AutofillBehavior.Never
  const revoked = await provider.readLogin(ref, 'https://example.com').catch((error) => error.code)
  assert({
    given: 'an exact-host login, a fresh website-wide revision, and a later never-fill revision',
    should: 'keep each read’s scope independent and reject a newly revoked login',
    actual: [
      exact.permitsOrigin?.('https://api.example.com'),
      website.permitsOrigin?.('https://api.example.com'),
      website.permitsOrigin?.('https://other.example'),
      website.permitsOrigin?.('http://api.example.com'),
      revoked,
    ],
    expected: [false, true, false, false, 'invalid-input'],
  })
})

test('a native scheme-less website survives discovery, fresh login validation and saved-code continuation', async () => {
  const { provider, ref, stored, counts } = fixture()
  const item = stored.get('vault-a')!
  item.websites = [{ url: 'example.com', label: 'Site', autofillBehavior: AutofillBehavior.AnywhereOnWebsite }]
  const listing = await provider.list()
  const found = listing.items.find((candidate) => candidate.ref.containerId === ref.containerId)!
  assert({
    given: 'a native Login with a website saved without a scheme',
    should: 'find the HTTPS login without reading or rewriting its fields',
    actual: [matchesLoginOrigin(found, 'https://example.com'), found.websites[0].url, counts()],
    expected: [true, 'example.com', { reads: 0, writes: 0 }],
  })
  const login = await provider.readLogin(ref, 'https://example.com')
  const otp = await provider.readLoginOtp(ref, 'https://example.com', login.otp!)
  item.websites[0].autofillBehavior = AutofillBehavior.Never
  const revoked = await provider.readLogin(ref, 'https://example.com').catch((error) => error.code)
  assert({
    given: 'fresh password and authenticator reads followed by a never-fill change',
    should: 'permit the saved HTTPS website and API only while its native scope allows it',
    actual: [
      login.password.use((value) => value === 'mock-password'),
      login.permitsOrigin?.('https://api.example.com'),
      login.permitsOrigin?.('http://api.example.com'),
      login.permitsOrigin?.('https://other.example'),
      otp.code.use((value) => value === '123456'),
      revoked,
      counts().writes,
    ],
    expected: [true, true, false, false, true, 'invalid-input', 0],
  })
})

test('ambiguous or missing authenticators never become a login verification binding', async () => {
  for (const count of [0, 2]) {
    const { provider, ref, stored } = fixture()
    const item = stored.get('vault-a')!
    const field = item.fields.find((field) => field.fieldType === 'Totp')!
    item.fields = item.fields.filter((field) => field.fieldType !== 'Totp')
    for (let i = 0; i < count; i++) item.fields.push({ ...field, id: `code-${i}` })
    const login = await provider.readLogin(ref, 'https://example.com')
    assert({
      given: `${count} authenticator fields on the selected login`,
      should: 'leave verification to the person',
      actual: login.otp,
      expected: undefined,
    })
  }
})

test('1Password creation stores generic secret fields and keeps its provider-assigned identity', async () => {
  const { provider, stored } = fixture()
  const item = await provider.create({
    containerId: 'vault-b',
    title: 'Widget API',
    nativeCategory: 'ApiCredentials',
    fields: [{ id: 'key', sectionId: 'api', label: 'Key', kind: 'secret', value: 'mock-api-key' }],
  })
  assert({
    given: 'a new API credential',
    should: 'map its native category and a concealed field',
    actual: [item.ref.itemId, item.nativeCategory, stored.get('vault-b')?.fields[0]],
    expected: [
      'provider-allocated-id',
      'ApiCredentials',
      { id: 'key', sectionId: 'api', title: 'Key', fieldType: 'Concealed', value: 'mock-api-key' },
    ],
  })
})

test('expired 1Password sessions require explicit access recovery', async () => {
  const { provider, client, ref } = fixture()
  class DesktopSessionExpiredError extends Error {}
  client.items.get = async () => {
    throw new DesktopSessionExpiredError('mock-sensitive-details')
  }
  const result = await provider.inspect(ref).catch((error) => [error.code, JSON.stringify(error)])
  assert({
    given: 'an expired desktop authorization',
    should: 'request access without echoing the native error',
    actual: result,
    expected: [
      'access-required',
      '{"code":"access-required","message":"The credential provider needs you to restore access."}',
    ],
  })
})
