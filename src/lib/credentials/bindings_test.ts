import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { assert, test } from '#test'
import { CredentialBindings } from './bindings.ts'
import type { CredentialBinding } from './types.ts'

const binding: CredentialBinding = {
  purpose: 'widget/api',
  fields: { key: { item: { connectionId: 'personal', containerId: 'vault-a', itemId: 'item-1' }, id: 'key' } },
}

test('bindings survive concurrent saves and unlink without accessing providers', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sky-credential-bindings-'))
  const file = path.join(dir, 'bindings.json')
  try {
    const one = new CredentialBindings(file)
    const two = new CredentialBindings(file)
    await Promise.all([one.save(binding), two.save({ ...binding, purpose: 'widget/login' })])
    assert({
      given: 'two simultaneous saves',
      should: 'preserve both references with private file permissions',
      actual: [(await one.list()).length, (await stat(file)).mode & 0o777],
      expected: [2, 0o600],
    })
    await one.unlink('widget/api')
    assert({
      given: 'unlinking a purpose',
      should: 'leave the other binding intact',
      actual: [await two.get('widget/api'), (await two.get('widget/login'))?.purpose],
      expected: [null, 'widget/login'],
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('binding storage rejects secret payloads and refuses to overwrite malformed state', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sky-credential-bindings-'))
  const file = path.join(dir, 'bindings.json')
  try {
    const bindings = new CredentialBindings(file)
    const injected = await bindings
      .save({
        ...binding,
        fields: { key: { ...binding.fields.key, value: 'mock-accidental-secret' } },
      } as CredentialBinding)
      .catch((error) => error.code)
    await writeFile(file, '{invalid')
    const malformed = await bindings.save(binding).catch((error) => error.code)
    assert({
      given: 'a secret accidentally passed as metadata and a corrupt file',
      should: 'fail without persisting the secret or erasing the file',
      actual: [injected, malformed, await readFile(file, 'utf8')],
      expected: ['invalid-input', 'unavailable', '{invalid'],
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
