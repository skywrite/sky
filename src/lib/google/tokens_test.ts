import { TestSecretsProvider } from '#lib/secrets/TestSecretsProvider.ts'
import { assert, test } from '#test'
import {
  deleteAccountTokens,
  listAccountEmails,
  loadAccountTokens,
  loadOAuthClient,
  parseStoredTokens,
  saveAccountTokens,
  saveOAuthClient,
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
  await saveAccountTokens(secrets, 'zed@example.com', { refreshToken: 'rt-z', scopes: [] })
  await saveAccountTokens(secrets, 'jane@example.com', { refreshToken: 'rt-j', scopes: [] })

  assert({
    given: 'a client entry and two accounts',
    should: 'list only account emails, sorted',
    expected: ['jane@example.com', 'zed@example.com'],
    actual: await listAccountEmails(secrets),
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
