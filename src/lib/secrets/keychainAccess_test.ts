import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { assert, test } from '#test'
import { KeychainAccess } from './keychainAccess.ts'
import { KeychainAccessError } from './keychainProtocol.ts'
import { KeychainSecretsProvider } from './KeychainSecretsProvider.ts'

test('KeychainAccess shares simultaneous reads and caches their result', async () => {
  let calls = 0
  const access = new KeychainAccess(
    '/unused',
    async () => {
      calls++
      return 'mock-value'
    },
    () => 0,
    async () => '',
  )
  const values = await Promise.all(Array.from({ length: 50 }, () => access.get('sky-test', 'main')))
  await access.get('sky-test', 'main')
  assert({
    given: 'fifty concurrent reads followed by another read',
    should: 'perform one OS operation',
    actual: [calls, values.every((value) => value === 'mock-value')],
    expected: [1, true],
  })
})

test('KeychainAccess pauses failures and explicit recovery bypasses the pause', async () => {
  let calls = 0
  const access = new KeychainAccess(
    '/unused',
    async (request) => {
      calls++
      if (!request.interactive) throw new KeychainAccessError('access', -25308)
      return 'restored'
    },
    () => 0,
    async () => '',
  )
  await Promise.allSettled(Array.from({ length: 20 }, () => access.get('sky-test', 'main')))
  await access.get('sky-test', 'main').catch(() => {})
  assert({ given: 'a denied read and subsequent polling', should: 'stop asking the OS', actual: calls, expected: 1 })
  const restored = await access.get('sky-test', 'main', true)
  assert({
    given: 'explicit recovery',
    should: 'make one new interactive attempt',
    actual: [calls, restored],
    expected: [2, 'restored'],
  })
})

test('KeychainAccess invalidates a read that races a write', async () => {
  let finishRead!: () => void
  let started!: () => void
  const reading = new Promise<void>((resolve) => {
    started = resolve
  })
  const finish = new Promise<void>((resolve) => {
    finishRead = resolve
  })
  let stored = 'old'
  const access = new KeychainAccess(
    '/unused',
    async (request) => {
      if (request.operation === 'set') {
        stored = request.value!
        return null
      }
      const value = stored
      started()
      await finish
      return value
    },
    () => 0,
    async () => '',
  )
  const before = access.get('sky-test', 'main')
  await reading
  const writing = access.mutate('set', 'sky-test', 'main', 'new')
  const after = access.get('sky-test', 'main')
  finishRead()
  await writing
  assert({
    given: 'an old read finishes while a write is queued',
    should: 'keep the new value for later readers',
    actual: [await before, await after, await access.get('sky-test', 'main')],
    expected: ['old', 'new', 'new'],
  })
})

test('KeychainAccess notices recovery or mutation in another process', async () => {
  let revision = 'first'
  let calls = 0
  const access = new KeychainAccess(
    '/unused',
    async () => String(++calls),
    () => 0,
    async () => revision,
  )
  const first = await access.get('sky-test', 'main')
  revision = 'second'
  const second = await access.get('sky-test', 'main')
  assert({
    given: 'the shared revision changes',
    should: 'discard the cached value',
    actual: [first, second],
    expected: ['1', '2'],
  })
})

test('a failed Keychain delete preserves the secret index', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sky-keychain-index-'))
  try {
    const index = path.join(dir, 'index.yaml')
    await writeFile(index, '- category: test\n  name: main\n  type: secret\n')
    const access = new KeychainAccess(dir, async () => {
      throw new KeychainAccessError('access')
    })
    const provider = new KeychainSecretsProvider(access, index)
    const error = await provider.delete('test', 'main').catch((err: unknown) => err)
    assert({
      given: 'macOS refuses a delete',
      should: 'surface the failure and retain the index entry',
      actual: [error instanceof KeychainAccessError, (await provider.list()).length],
      expected: [true, 1],
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
