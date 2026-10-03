import { mkdtemp, rm } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { TestSecretsProvider } from '#lib/secrets/TestSecretsProvider.ts'
import { assert, test } from '#test'
import { findBatchLogin, type BatchLoginDeps, type BatchLoginProvider } from './batchLogin.ts'
import { CredentialBindings } from './bindings.ts'
import { CredentialError } from './errors.ts'
import type { LoginValues } from './login.ts'
import { PasswordManagerSettingsStore } from './passwordManagers.ts'
import { SensitiveValue } from './SensitiveValue.ts'
import type { CredentialSummary, ItemRef } from './types.ts'

const ORIGIN = 'https://atlas.example'
const PURPOSE = 'atlas/login'
const SOURCE = {
  id: '1password:acct',
  account: 'acct',
  label: 'Example account',
  excludedVaultIds: [],
  containers: [{ id: 'vault-1', label: 'Private' }],
}
const ref = (itemId: string): ItemRef => ({ connectionId: SOURCE.id, containerId: 'vault-1', itemId })
const item = (itemId: string, url: string, match: 'exact' | 'never' = 'exact'): CredentialSummary => ({
  ref: ref(itemId),
  title: `Atlas ${itemId}`,
  nativeCategory: 'Login',
  websites: [{ url, match }],
  tags: [],
})
const values = (): LoginValues => ({
  username: new SensitiveValue('jane@example.com'),
  password: new SensitiveValue('mock-Atlas-password-497!'),
})
const keychainLogin = {
  type: 'login' as const,
  schema: '1.0.0',
  created: '2026-01-01T00:00:00Z',
  updated: '2026-01-01T00:00:00Z',
  user: 'jane@example.com',
  pass: 'mock-keychain-password',
}

async function fixture(options: {
  items?: CredentialSummary[]
  connected?: boolean
  connect?: () => Promise<BatchLoginProvider>
  readFails?: (ref: ItemRef) => CredentialError | undefined
}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sky-batch-login-test-'))
  const counts = { connect: 0, list: 0, read: 0 }
  const provider: BatchLoginProvider = {
    list: async () => {
      counts.list++
      return { items: options.items ?? [], issues: [] }
    },
    readFields: async (ref, fields) => {
      counts.read++
      const failure = options.readFails?.(ref)
      if (failure) throw failure
      const login = values()
      return fields.map((field) => ({
        field: { ...field },
        value: field.id === 'username' ? login.username : login.password,
      }))
    },
  }
  const deps: BatchLoginDeps = {
    sourcesFile: path.join(dir, 'sources.json'),
    bindingsFile: path.join(dir, 'bindings.json'),
    connect: async () => {
      counts.connect++
      return options.connect ? options.connect() : provider
    },
  }
  if (options.connected ?? true)
    await new PasswordManagerSettingsStore(deps.sourcesFile).update((settings) => {
      settings.sources.push(SOURCE)
    })
  const bindings = new CredentialBindings(deps.bindingsFile)
  return { deps, counts, bindings, done: () => rm(dir, { recursive: true, force: true }) }
}

const plain = (login: LoginValues) => [login.username.use((v) => v), login.password.use((v) => v)]

test('a lone login carrying the origin is used and remembered; never-fill and other sites stay out', async () => {
  const f = await fixture({
    items: [item('other', 'https://other.example'), item('never', ORIGIN, 'never'), item('atlas', ORIGIN)],
  })
  try {
    const found = await findBatchLogin({ purpose: PURPOSE, origin: ORIGIN }, f.deps)
    assert({
      given: 'one matching Login item among others in a connected account',
      should: 'read it, name the account, and save the pick for next time',
      actual: [
        found.status,
        found.status === 'found' && [found.source, found.where, ...plain(found.login)],
        (await f.bindings.get(PURPOSE))?.fields.login?.item.itemId,
        f.counts,
      ],
      expected: [
        'found',
        ['password-manager', '1Password (Example account)', 'jane@example.com', 'mock-Atlas-password-497!'],
        'atlas',
        { connect: 1, list: 1, read: 1 },
      ],
    })
  } finally {
    await f.done()
  }
})

test('a website saved as the root domain names the origin; siblings and lookalikes do not', async () => {
  const f = await fixture({
    items: [
      item('root', 'atlas.example'),
      item('sibling', 'https://community.atlas.example'),
      item('lookalike', 'https://notatlas.example'),
      item('suffix', 'https://www.atlas.example.evil.example'),
      item('never', 'www.atlas.example', 'never'),
    ],
  })
  const g = await fixture({
    items: [item('root', 'atlas.example'), item('host', 'www.atlas.example'), item('http', 'http://www.atlas.example')],
  })
  try {
    const root = await findBatchLogin({ purpose: PURPOSE, origin: 'https://www.atlas.example' }, f.deps)
    const both = await findBatchLogin({ purpose: PURPOSE, origin: 'https://www.atlas.example' }, g.deps)
    assert({
      given: 'a root domain beside a sibling subdomain, a lookalike, a suffix trick and a never-fill entry',
      should: 'take the root domain alone and remember it',
      actual: [root.status, (await f.bindings.get(PURPOSE))?.fields.login?.item.itemId],
      expected: ['found', 'root'],
    })
    assert({
      given: 'items naming the exact host beside one naming the root domain',
      should: 'offer only the exact-host items',
      actual: [both.status, both.status === 'choose' && both.choices.map((choice) => choice.ref.itemId)],
      expected: ['choose', ['host', 'http']],
    })
  } finally {
    await f.done()
    await g.done()
  }
})

test('a remembered pick is read without a search', async () => {
  const f = await fixture({ items: [item('atlas', ORIGIN), item('atlas-2', ORIGIN)] })
  try {
    await f.bindings.save({ purpose: PURPOSE, fields: { login: { item: ref('atlas-2'), id: 'password' } } })
    const found = await findBatchLogin({ purpose: PURPOSE, origin: ORIGIN }, f.deps)
    assert({
      given: 'a binding saved for the purpose',
      should: 'read that item and never list the vaults',
      actual: [found.status, f.counts],
      expected: ['found', { connect: 1, list: 0, read: 1 }],
    })
  } finally {
    await f.done()
  }
})

test('several matching logins are the person’s to choose, once', async () => {
  const f = await fixture({ items: [item('atlas', ORIGIN), item('atlas-2', ORIGIN)] })
  try {
    const found = await findBatchLogin({ purpose: PURPOSE, origin: ORIGIN }, f.deps)
    assert({
      given: 'two Login items carrying the origin',
      should: 'offer both with account and vault, read nothing, and save no pick',
      actual: [
        found.status,
        found.status === 'choose' && found.choices.map((choice) => [choice.title, choice.account, choice.vault]),
        f.counts.read,
        await f.bindings.get(PURPOSE),
      ],
      expected: [
        'choose',
        [
          ['Atlas atlas', 'Example account', 'Private'],
          ['Atlas atlas-2', 'Example account', 'Private'],
        ],
        0,
        null,
      ],
    })
  } finally {
    await f.done()
  }
})

test('the keychain entry stands in when no password manager has the login', async () => {
  const f = await fixture({ items: [item('other', 'https://other.example')] })
  const secrets = new TestSecretsProvider({ 'atlas/main': keychainLogin })
  try {
    const found = await findBatchLogin(
      { purpose: PURPOSE, origin: ORIGIN, keychain: { secrets, category: 'atlas', name: 'main' } },
      f.deps,
    )
    const none = await findBatchLogin(
      {
        purpose: PURPOSE,
        origin: ORIGIN,
        keychain: { secrets: new TestSecretsProvider(), category: 'atlas', name: 'main' },
      },
      f.deps,
    )
    assert({
      given: 'no matching item, with and without a keychain entry',
      should: 'use the keychain login, else report none',
      actual: [found.status, found.status === 'found' && [found.source, ...plain(found.login)], none.status],
      expected: ['found', ['keychain', 'jane@example.com', 'mock-keychain-password'], 'none'],
    })
  } finally {
    await f.done()
  }
})

test('a locked password manager falls back to the keychain, and is reported without one', async () => {
  const f = await fixture({
    connect: async () => {
      throw new CredentialError('access-required')
    },
  })
  const secrets = new TestSecretsProvider({ 'atlas/main': keychainLogin })
  try {
    const found = await findBatchLogin(
      { purpose: PURPOSE, origin: ORIGIN, keychain: { secrets, category: 'atlas', name: 'main' } },
      f.deps,
    )
    const locked = await findBatchLogin({ purpose: PURPOSE, origin: ORIGIN }, f.deps)
    assert({
      given: 'a connect that reports access required',
      should: 'take the keychain entry, and otherwise say the manager is locked',
      actual: [
        found.status,
        found.status === 'found' && found.source,
        locked.status,
        locked.status === 'locked' && locked.message,
      ],
      expected: ['found', 'keychain', 'locked', 'The credential provider needs you to restore access.'],
    })
  } finally {
    await f.done()
  }
})

test('a password manager that never answers counts as locked', async () => {
  const f = await fixture({ connect: () => new Promise<never>(() => {}) })
  try {
    const locked = await findBatchLogin({ purpose: PURPOSE, origin: ORIGIN, timeoutMs: 50 }, f.deps)
    assert({
      given: 'a connect that hangs past the deadline',
      should: 'give up and say it may be locked or waiting for approval',
      actual: [locked.status, locked.status === 'locked' && locked.message],
      expected: ['locked', '1Password did not answer in time; it may be locked or waiting for your approval.'],
    })
  } finally {
    await f.done()
  }
})

test('a remembered login that is gone is forgotten, and the search runs again', async () => {
  const f = await fixture({
    items: [item('atlas', ORIGIN)],
    readFails: (ref) => (ref.itemId === 'gone' ? new CredentialError('not-found') : undefined),
  })
  try {
    await f.bindings.save({ purpose: PURPOSE, fields: { login: { item: ref('gone'), id: 'password' } } })
    const lines: string[] = []
    const found = await findBatchLogin({ purpose: PURPOSE, origin: ORIGIN, log: (line) => lines.push(line) }, f.deps)
    assert({
      given: 'a binding to an item the provider no longer has',
      should: 'drop it, find the current item, and remember that one instead',
      actual: [found.status, (await f.bindings.get(PURPOSE))?.fields.login?.item.itemId, lines, f.counts],
      expected: [
        'found',
        'atlas',
        ['The remembered login no longer fits; looking again.'],
        { connect: 1, list: 1, read: 2 },
      ],
    })
  } finally {
    await f.done()
  }
})
