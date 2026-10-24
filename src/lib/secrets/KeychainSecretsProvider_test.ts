import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { exists } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import { KeychainAccess } from './keychainAccess.ts'
import { KeychainSecretsProvider } from './KeychainSecretsProvider.ts'
import { createSecret } from './marshal.ts'

const original = '- category: test\n  name: main\n- category: test\n  name: other\n  type: login\n'
const entries = [
  { category: 'test', name: 'main', type: 'secret' },
  { category: 'test', name: 'other', type: 'login' },
]

async function withFixture(
  run: (fixture: {
    dir: string
    index: string
    legacy: string
    calls: string[]
    provider: KeychainSecretsProvider
  }) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sky-secrets-index-'))
  const index = path.join(dir, 'state', 'keychain', 'index.yaml')
  const legacy = path.join(dir, 'notebook', 'secrets', 'index.yaml')
  const calls: string[] = []
  const access = new KeychainAccess(
    dir,
    async (request) => {
      calls.push(request.operation)
      return null
    },
    () => 0,
    async () => '',
  )
  try {
    await mkdir(path.dirname(legacy), { recursive: true })
    await writeFile(legacy, original)
    await run({ dir, index, legacy, calls, provider: new KeychainSecretsProvider(access, index, legacy) })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('the Keychain index migrates out of the notebook on first listing', async () => {
  await withFixture(async ({ index, legacy, calls, provider }) => {
    const listed = await provider.list()
    assert({
      given: 'an existing notebook index, including an entry without a type',
      should: 'preserve account discovery and the original bytes in state without accessing Keychain',
      actual: {
        listed,
        content: await readFile(index, 'utf8'),
        notebookFolder: await exists(path.dirname(legacy)),
        calls,
      },
      expected: { listed: entries, content: original, notebookFolder: false, calls: [] },
    })
  })
})

for (const operation of ['set', 'delete'] as const) {
  test(`the Keychain index migrates before the first ${operation}`, async () => {
    await withFixture(async ({ index, legacy, calls, provider }) => {
      if (operation === 'set') await provider.set('test', 'fresh', createSecret('synthetic-value'))
      else await provider.delete('test', 'main')
      assert({
        given: `a ${operation} before any listing of the old index`,
        should: 'apply the mutation to the migrated entries and keep the notebook clear',
        actual: { entries: await provider.list(), state: await exists(index), legacy: await exists(legacy), calls },
        expected: {
          entries:
            operation === 'set' ? [{ category: 'test', name: 'fresh', type: 'secret' }, ...entries] : entries.slice(1),
          state: true,
          legacy: false,
          calls: [operation],
        },
      })
    })
  })
}

test('Keychain index migration resumes after an interrupted move and preserves other notebook files', async () => {
  await withFixture(async ({ index, legacy, provider }) => {
    await mkdir(path.dirname(index), { recursive: true })
    await writeFile(index, original)
    const other = path.join(path.dirname(legacy), 'notes.md')
    await writeFile(other, 'Synthetic notes\n')
    assert({
      given: 'identical indexes in both locations and another file in the old folder',
      should: 'finish migration without deleting the other file',
      actual: {
        entries: await provider.list('test'),
        legacy: await exists(legacy),
        content: await readFile(index, 'utf8'),
        other: await readFile(other, 'utf8'),
      },
      expected: { entries, legacy: false, content: original, other: 'Synthetic notes\n' },
    })
  })
})

test('conflicting Keychain indexes are preserved before any credential mutation and migration can be retried', async () => {
  await withFixture(async ({ index, legacy, calls, provider }) => {
    const conflicting = '- category: test\n  name: fresh\n  type: secret\n'
    await mkdir(path.dirname(index), { recursive: true })
    await writeFile(index, conflicting)
    const error = await provider.delete('test', 'main').catch((error: unknown) => error)
    assert({
      given: 'different indexes in the notebook and state directory',
      should: 'identify both files, preserve both copies, and leave Keychain untouched',
      actual: {
        explained: error instanceof Error && error.message.includes(index) && error.message.includes(legacy),
        legacy: await readFile(legacy, 'utf8'),
        state: await readFile(index, 'utf8'),
        calls,
      },
      expected: { explained: true, legacy: original, state: conflicting, calls: [] },
    })
    await rm(index)
    assert({
      given: 'the destination conflict is resolved',
      should: 'retry migration on the same provider',
      actual: await provider.list(),
      expected: entries,
    })
  })
})

test('failed Keychain index migration leaves the original available', async () => {
  await withFixture(async ({ index, legacy, provider }) => {
    await mkdir(path.dirname(path.dirname(index)), { recursive: true })
    await writeFile(path.dirname(index), 'Synthetic obstruction')
    const error = await provider.list().catch((error: unknown) => error)
    assert({
      given: 'the state destination cannot be created',
      should: 'surface the error and preserve the notebook index',
      actual: [error instanceof Error, await readFile(legacy, 'utf8')],
      expected: [true, original],
    })
  })
})

test('Keychain index migration refuses a destination symlink to the original', async () => {
  await withFixture(async ({ index, legacy, provider }) => {
    await mkdir(path.dirname(index), { recursive: true })
    await symlink(legacy, index)
    const error = await provider.list().catch((error: unknown) => error)
    assert({
      given: 'the state index is a symbolic link to the notebook index',
      should: 'preserve the original rather than break the link by deleting its target',
      actual: [error instanceof Error, await readFile(legacy, 'utf8'), (await lstat(index)).isSymbolicLink()],
      expected: [true, original, true],
    })
  })
})

test('a fresh Keychain index is created only in state', async () => {
  await withFixture(async ({ index, legacy, provider }) => {
    await rm(path.dirname(legacy), { recursive: true })
    const empty = await provider.list()
    await provider.set('test', 'fresh', createSecret('synthetic-value'))
    assert({
      given: 'a notebook without a legacy secrets folder',
      should: 'start empty and store new index entries only in state',
      actual: {
        empty,
        entries: await provider.list(),
        state: await exists(index),
        notebook: await exists(path.dirname(legacy)),
      },
      expected: {
        empty: [],
        entries: [{ category: 'test', name: 'fresh', type: 'secret' }],
        state: true,
        notebook: false,
      },
    })
  })
})
