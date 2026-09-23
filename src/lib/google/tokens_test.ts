import { TestSecretsProvider } from '#lib/secrets/TestSecretsProvider.ts'
import { assert, test } from '#test'
import {
  deleteAccountTokens,
  hasAnyOAuthClient,
  listAccountEmails,
  loadAccountClient,
  loadAccountTokens,
  loadOAuthClient,
  loadProjectClient,
  parseStoredTokens,
  projectClientEntryName,
  saveAccountTokens,
  saveOAuthClient,
  saveProjectClient,
  serializeStoredTokens,
} from './tokens.ts'

test('oauth client roundtrip', async () => {
  const secrets = new TestSecretsProvider()

  assert({
    given: 'an empty keychain',
    should: 'have no oauth client',
    expected: null,
    actual: await loadOAuthClient(secrets),
  })

  await saveOAuthClient(secrets, { clientId: 'id-1', clientSecret: 'secret-1' })
  assert({
    given: 'a stored client pair',
    should: 'load it back as a login entry',
    expected: { clientId: 'id-1', clientSecret: 'secret-1' },
    actual: await loadOAuthClient(secrets),
  })

  await saveOAuthClient(secrets, { clientId: 'id-2', clientSecret: 'secret-2' })
  assert({
    given: 'a re-saved client pair',
    should: 'update in place',
    expected: { clientId: 'id-2', clientSecret: 'secret-2' },
    actual: await loadOAuthClient(secrets),
  })
})

test('account tokens roundtrip', async () => {
  const secrets = new TestSecretsProvider()
  const tokens = {
    refreshToken: 'rt-1',
    accessToken: 'at-1',
    scopes: ['openid', 'email'],
  }

  await saveAccountTokens(secrets, 'jane@example.com', tokens)
  assert({
    given: 'stored account tokens',
    should: 'load back unchanged',
    expected: tokens,
    actual: await loadAccountTokens(secrets, 'jane@example.com'),
  })

  await deleteAccountTokens(secrets, 'jane@example.com')
  assert({
    given: 'a deleted account',
    should: 'load as null',
    expected: null,
    actual: await loadAccountTokens(secrets, 'jane@example.com'),
  })
})

test('listAccountEmails', async () => {
  const secrets = new TestSecretsProvider()
  await saveOAuthClient(secrets, { clientId: 'id', clientSecret: 'sec' })
  await saveProjectClient(secrets, 'atlas-123456', { clientId: 'id-p', clientSecret: 'sec-p' })
  await saveAccountTokens(secrets, 'zed@example.com', { refreshToken: 'rt-z', scopes: [] })
  await saveAccountTokens(secrets, 'jane@example.com', { refreshToken: 'rt-j', scopes: [] })

  assert({
    given: 'a shared client, a client Sky made, and two accounts',
    should: 'list only account emails, sorted',
    expected: ['jane@example.com', 'zed@example.com'],
    actual: await listAccountEmails(secrets),
  })
})

test('the client that refreshes an account', async () => {
  const secrets = new TestSecretsProvider()
  assert({
    given: 'an empty keychain',
    should: 'have no client of any kind',
    expected: false,
    actual: await hasAnyOAuthClient(secrets),
  })

  await saveProjectClient(secrets, 'atlas-123456', { clientId: 'id-p', clientSecret: 'sec-p' })
  await saveAccountTokens(secrets, 'jane@example.com', {
    refreshToken: 'rt-j',
    scopes: [],
    client: projectClientEntryName('atlas-123456'),
    setup: { projectId: 'atlas-123456', at: '2026-01-02T03:04:05.000Z' },
  })
  await saveAccountTokens(secrets, 'zed@example.com', { refreshToken: 'rt-z', scopes: [] })

  assert({
    given: 'only a client Sky made',
    should: 'count as a client',
    expected: true,
    actual: await hasAnyOAuthClient(secrets),
  })
  assert({
    given: 'an account whose grant names the client Sky made',
    should: 'refresh with that pair',
    expected: { clientId: 'id-p', clientSecret: 'sec-p' },
    actual: await loadAccountClient(secrets, 'jane@example.com'),
  })
  assert({
    given: 'an account whose grant names no client, with no shared client stored',
    should: 'have none',
    expected: null,
    actual: await loadAccountClient(secrets, 'zed@example.com'),
  })

  await saveOAuthClient(secrets, { clientId: 'id-s', clientSecret: 'sec-s' })
  assert({
    given: 'the shared client stored too',
    should: 'serve the account that names no client, and leave the other on its own pair',
    expected: [
      { clientId: 'id-s', clientSecret: 'sec-s' },
      { clientId: 'id-p', clientSecret: 'sec-p' },
      { clientId: 'id-p', clientSecret: 'sec-p' },
    ],
    actual: [
      await loadAccountClient(secrets, 'zed@example.com'),
      await loadAccountClient(secrets, 'jane@example.com'),
      await loadProjectClient(secrets, 'atlas-123456'),
    ],
  })
  assert({
    given: 'the grant with a client and a setup',
    should: 'keep both through the keychain',
    expected: {
      refreshToken: 'rt-j',
      accessToken: undefined,
      scopes: [],
      client: 'client:atlas-123456',
      setup: { projectId: 'atlas-123456', at: '2026-01-02T03:04:05.000Z' },
    },
    actual: await loadAccountTokens(secrets, 'jane@example.com'),
  })
})

test('parseStoredTokens guards', () => {
  assert({
    given: 'a serialized token blob',
    should: 'roundtrip through parse',
    expected: { refreshToken: 'rt', accessToken: undefined, scopes: ['email'] },
    actual: parseStoredTokens(serializeStoredTokens({ refreshToken: 'rt', scopes: ['email'] })),
  })

  assert({
    given: 'garbage values',
    should: 'parse to null instead of throwing',
    expected: [null, null, null],
    actual: [parseStoredTokens('not json'), parseStoredTokens('{}'), parseStoredTokens('{"v":2,"refreshToken":"rt"}')],
  })
})
