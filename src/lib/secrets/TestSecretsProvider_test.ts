import { assert, test } from '#test'
import { createLogin, createSecret } from './marshal.ts'
import { TestSecretsProvider } from './TestSecretsProvider.ts'
import type { LoginEntry } from './types.ts'

// ── Basic CRUD ───────────────────────────────────────────────────────

test('TestSecretsProvider - get returns null for missing entry', async () => {
  const provider = new TestSecretsProvider()
  const result = await provider.get('gmail', 'personal')

  assert({
    given: 'a missing entry',
    should: 'return null',
    actual: result,
    expected: null,
  })
})

test('TestSecretsProvider - set and get roundtrip', async () => {
  const provider = new TestSecretsProvider()
  const entry = createLogin({ user: 'jp@gmail.com', pass: 'secret' })
  await provider.set('gmail', 'personal', entry)
  const result = await provider.get('gmail', 'personal')

  assert({
    given: 'a stored login entry',
    should: 'return type login',
    actual: result?.type,
    expected: 'login',
  })

  assert({
    given: 'a stored login entry',
    should: 'return correct user',
    actual: (result as LoginEntry)?.user,
    expected: 'jp@gmail.com',
  })
})

test('TestSecretsProvider - delete removes entry', async () => {
  const provider = new TestSecretsProvider()
  await provider.set('gmail', 'personal', createLogin({ user: 'u', pass: 'p' }))
  await provider.delete('gmail', 'personal')
  const result = await provider.get('gmail', 'personal')

  assert({
    given: 'a deleted entry',
    should: 'return null',
    actual: result,
    expected: null,
  })
})

test('TestSecretsProvider - delete is no-op for missing entry', async () => {
  const provider = new TestSecretsProvider()
  await provider.delete('gmail', 'nonexistent')

  assert({
    given: 'deleting a nonexistent entry',
    should: 'not throw',
    actual: true,
    expected: true,
  })
})

// ── Constructor with initial values ──────────────────────────────────

test('TestSecretsProvider - constructor pre-loads entries', async () => {
  const provider = new TestSecretsProvider({
    'gmail/personal': createLogin({ user: 'jp@gmail.com', pass: 'pw' }),
    'anthropic/main': createSecret('sk-123'),
  })

  const login = await provider.get('gmail', 'personal')
  const secret = await provider.get('anthropic', 'main')

  assert({
    given: 'pre-loaded entries',
    should: 'retrieve login',
    actual: login?.type,
    expected: 'login',
  })

  assert({
    given: 'pre-loaded entries',
    should: 'retrieve secret',
    actual: secret?.type,
    expected: 'secret',
  })
})

// ── List ─────────────────────────────────────────────────────────────

test('TestSecretsProvider - list returns all entries', async () => {
  const provider = new TestSecretsProvider({
    'gmail/personal': createLogin({ user: 'u', pass: 'p' }),
    'anthropic/main': createSecret('sk-123'),
  })

  const entries = await provider.list()

  assert({
    given: 'two stored entries',
    should: 'return count of 2',
    actual: entries.length,
    expected: 2,
  })
})

test('TestSecretsProvider - list filters by category', async () => {
  const provider = new TestSecretsProvider({
    'gmail/personal': createLogin({ user: 'u1', pass: 'p1' }),
    'gmail/work': createLogin({ user: 'u2', pass: 'p2' }),
    'anthropic/main': createSecret('sk-123'),
  })

  const entries = await provider.list('gmail')

  assert({
    given: 'filtering by gmail category',
    should: 'return 2 entries',
    actual: entries.length,
    expected: 2,
  })

  assert({
    given: 'filtering by gmail category',
    should: 'all be gmail category',
    actual: entries.every((e) => e.category === 'gmail'),
    expected: true,
  })
})

test('TestSecretsProvider - list includes type from entry', async () => {
  const provider = new TestSecretsProvider({
    'gmail/personal': createLogin({ user: 'u', pass: 'p' }),
  })

  const entries = await provider.list()

  assert({
    given: 'a login entry',
    should: 'list with type login',
    actual: entries[0]?.type,
    expected: 'login',
  })
})

test('TestSecretsProvider - list returns empty for no matches', async () => {
  const provider = new TestSecretsProvider({
    'gmail/personal': createLogin({ user: 'u', pass: 'p' }),
  })

  const entries = await provider.list('slack')

  assert({
    given: 'no entries in category',
    should: 'return empty array',
    actual: entries.length,
    expected: 0,
  })
})

// ── Overwrite ────────────────────────────────────────────────────────

test('TestSecretsProvider - set overwrites existing entry', async () => {
  const provider = new TestSecretsProvider()
  await provider.set('gmail', 'personal', createLogin({ user: 'old@gmail.com', pass: 'old' }))
  await provider.set('gmail', 'personal', createLogin({ user: 'new@gmail.com', pass: 'new' }))

  const result = (await provider.get('gmail', 'personal')) as LoginEntry

  assert({
    given: 'an overwritten entry',
    should: 'return the new user',
    actual: result.user,
    expected: 'new@gmail.com',
  })
})
