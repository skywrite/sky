import { assert, test } from '#test'
import { CredentialService, matchesWebsite } from './CredentialService.ts'
import { CredentialError } from './errors.ts'
import { SensitiveValue } from './SensitiveValue.ts'
import type { CredentialProvider, CredentialSummary } from './types.ts'

const item: CredentialSummary = {
  ref: { connectionId: 'one', containerId: 'vault', itemId: 'widget' },
  title: 'Widget API',
  nativeCategory: 'Login',
  tags: [],
  websites: [{ url: 'https://example.com', match: 'subdomains' }],
}

function provider(id: string): CredentialProvider {
  return {
    connection: { id, provider: '1password', label: id },
    listContainers: async () => [{ id: 'vault', label: 'Vault' }],
    list: async () => ({ items: [{ ...item, ref: { ...item.ref, connectionId: id } }], issues: [] }),
    inspect: async (ref) => ({ ...item, ref, revision: '1', fields: [{ id: 'key', label: 'Key', kind: 'secret' }] }),
    readFields: async (_ref, selectors) => selectors.map((field) => ({ field, value: new SensitiveValue('mock-key') })),
  }
}

test('credential search combines metadata and preserves access failures', async () => {
  const locked = provider('locked')
  locked.list = async () => {
    throw new CredentialError('access-required')
  }
  const service = new CredentialService([provider('one'), locked])
  const result = await service.search({ text: 'widget', website: 'https://login.example.com/sign-in' })
  assert({
    given: 'one accessible and one locked provider',
    should: 'return both useful results and the access problem',
    actual: [
      result.items.map((entry) => entry.ref),
      result.issues.map((issue) => [issue.connectionId, issue.error.code]),
    ],
    expected: [[item.ref], [['locked', 'access-required']]],
  })
})

test('credential website matching uses origin boundaries and provider rules', () => {
  const urls = [
    'https://example.com/login',
    'https://a.example.com',
    'https://evil-example.com',
    'https://example.com.evil.test',
    'http://example.com',
    'https://example.com:444',
  ]
  assert({
    given: 'a credential allowing subdomains',
    should: 'exclude lookalikes, downgrades and different ports',
    actual: urls.map((url) => matchesWebsite(item, url)),
    expected: [true, true, false, false, false, false],
  })
  assert({
    given: 'exact or disabled autofill rules',
    should: 'honor those rules',
    actual: ['exact', 'never'].map((match) =>
      matchesWebsite(
        { ...item, websites: [{ url: 'https://example.com', match: match as 'exact' | 'never' }] },
        'https://a.example.com',
      ),
    ),
    expected: [false, false],
  })
})

test('credential references never fall through to another provider', async () => {
  let reads = 0
  const one = provider('one')
  one.readFields = async () => {
    reads++
    throw new Error('mock-secret-in-native-error')
  }
  const service = new CredentialService([one, provider('two')])
  const failed = await service.readFields(item.ref, [{ id: 'key' }]).catch((error) => [error.code, error.message])
  const absent = await service
    .readFields({ ...item.ref, connectionId: 'missing' }, [{ id: 'key' }])
    .catch((error) => error.code)
  const unsupported = await service.getOtp({ item: item.ref, id: 'key' }).catch((error) => error.code)
  assert({
    given: 'a failure, an unknown connection and an unsupported operation',
    should: 'surface sanitized distinct failures',
    actual: [failed, absent, unsupported, reads],
    expected: [
      ['unavailable', 'The credential provider could not complete the request.'],
      'not-found',
      'unsupported',
      1,
    ],
  })
})

test('credential service rejects ambiguous connection IDs and duplicate field patches', async () => {
  let duplicate = false
  try {
    new CredentialService([provider('one'), provider('one')])
  } catch {
    duplicate = true
  }
  const service = new CredentialService([provider('one')])
  const patch = await service
    .updateFields(
      item.ref,
      [
        { id: 'key', value: 'a' },
        { id: 'key', value: 'b' },
      ],
      '1',
    )
    .catch((error) => error.code)
  assert({
    given: 'ambiguous identities',
    should: 'reject before dispatching',
    actual: [duplicate, patch],
    expected: [true, 'invalid-input'],
  })
})
