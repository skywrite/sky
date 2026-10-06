import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { TestSecretsProvider } from '#lib/secrets/mod.ts'
import { assert, test } from '#test'
import { ExistingBrowserSettingsStore } from './settings.ts'

const TOKEN = 'mock_Atlas_extension_token_for_tests_only_1234'

test('browser preferences contain no token and retain a connection across restarts', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-browser-connection-'))
  const file = path.join(root, 'connection.json')
  const secrets = new TestSecretsProvider()
  const store = new ExistingBrowserSettingsStore(file, secrets)
  try {
    await store.connect(`PLAYWRIGHT_MCP_EXTENSION_TOKEN=${TOKEN}`, { browser: 'brave', profileDirName: 'Profile 2' })
    const restarted = new ExistingBrowserSettingsStore(file, secrets)
    assert({
      given: 'an explicit connection with a profile-specific token',
      should: 'keep only preferences on disk and retrieve the grant from the secret store',
      actual: [JSON.parse(await readFile(file, 'utf8')), (await stat(file)).mode & 0o777, await restarted.token()],
      expected: [{ browser: 'brave', profileDirName: 'Profile 2' }, 0o600, TOKEN],
    })
    await restarted.disconnect()
    assert({
      given: 'disconnect',
      should: 'remove the selected connection and its grant',
      actual: [await store.read(), await secrets.get('browser', 'playwright-extension')],
      expected: [undefined, null],
    })
    await writeFile(file, '{invalid')
    let message = ''
    try {
      await store.read()
    } catch (error) {
      message = (error as Error).message
    }
    assert({
      given: 'unreadable saved preferences',
      should: 'report a recovery action instead of silently choosing a new browser',
      actual: message.includes('Reconnect Brave'),
      expected: true,
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('browser connection errors never reflect token values', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-browser-token-test-'))
  const secrets = new TestSecretsProvider()
  const store = new ExistingBrowserSettingsStore(path.join(root, 'connection.json'), secrets)
  try {
    const messages: string[] = []
    try {
      await store.connect('mock secret with spaces')
    } catch (error) {
      messages.push((error as Error).message)
    }
    secrets.get = async () => {
      throw new Error(TOKEN)
    }
    try {
      await store.token()
    } catch (error) {
      messages.push((error as Error).message)
    }
    assert({
      given: 'an invalid token and a failed Keychain read',
      should: 'provide fixed useful errors without disclosing supplied or stored values',
      actual: [
        messages.length,
        messages.join('').includes(TOKEN),
        messages.join('').includes('mock secret with spaces'),
        await store.read(),
      ],
      expected: [2, false, false, undefined],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
