import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { assert, test } from '#test'
import { connectExistingBrowser } from './connection.ts'
import { resolveExtensionProfile } from './profile.ts'
import { EXTENSION_ID, ExistingBrowserError } from './settings.ts'

async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-extension-profile-'))
  try {
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function preferences(root: string, profile: string, record: unknown, file = 'Secure Preferences') {
  await mkdir(path.join(root, profile), { recursive: true })
  await writeFile(
    path.join(root, profile, file),
    JSON.stringify({ extensions: { settings: { [EXTENSION_ID]: record } } }),
  )
}

test('disabled and corrupted extensions fail before opening a browser connection page', async () =>
  fixture(async (root) => {
    const messages: string[] = []
    for (const [record, expected] of [
      [{ disable_reasons: [1024] }, 'corruption'],
      [{ disable_reasons: 1025 }, 'corruption'],
      [{ state: 0 }, 'disabled'],
      [{ disable_reasons: [1] }, 'disabled'],
    ] as const) {
      await preferences(root, 'Default', record)
      const file = path.join(root, 'Default', 'Secure Preferences')
      const before = await readFile(file, 'utf8')
      const error = await connectExistingBrowser(
        'mock_Atlas_extension_token_1234567890',
        { browser: 'brave' },
        {
          userDataDir: root,
          executablePath: path.join(root, 'must-not-launch'),
        },
      ).then(
        () => undefined,
        (failure: unknown) => failure,
      )
      messages.push(error instanceof Error ? error.message : '')
      assert({
        given: `an extension with ${expected} recorded by Brave`,
        should: 'explain the failure without launching a browser or changing extension preferences',
        actual: [
          error instanceof ExistingBrowserError,
          messages.at(-1)?.includes(expected),
          await readFile(file, 'utf8'),
        ],
        expected: [true, true, before],
      })
    }
    assert({
      given: 'extension failures',
      should: 'identify recovery without disclosing the connection token',
      actual: messages.every(
        (message) => message.includes('Settings → Browser automation') && !message.includes('mock_Atlas'),
      ),
      expected: true,
    })
  }))

test('profile selection follows the installed extension and never skips a disabled selected identity', async () =>
  fixture(async (root) => {
    await preferences(root, 'Default', { state: 1, disable_reasons: [] }, 'Preferences')
    await preferences(root, 'Profile 2', { disable_reasons: [] })
    await writeFile(path.join(root, 'Local State'), JSON.stringify({ profile: { last_used: 'Profile 2' } }))
    const automatic = await resolveExtensionProfile({ userDataDir: root })
    const explicit = await resolveExtensionProfile({ userDataDir: root, profileDirName: 'Default' })
    await preferences(root, 'Profile 2', { disable_reasons: [1024] })
    const disabled = await resolveExtensionProfile({ userDataDir: root }).catch((error) => error.message)
    const missing = await resolveExtensionProfile({ userDataDir: root, profileDirName: 'Profile 3' }).catch(
      (error) => error.message,
    )
    assert({
      given: 'multiple profiles, including a disabled last-used profile and a missing explicitly selected profile',
      should: 'match Playwright’s selection while refusing to switch to another signed-in identity on failure',
      actual: [automatic, explicit, disabled.includes('corruption'), missing.includes('missing')],
      expected: ['Profile 2', 'Default', true, true],
    })
  }))

test('secure extension state overrides legacy state and malformed preferences stay private', async () =>
  fixture(async (root) => {
    await preferences(root, 'Default', { state: 1 }, 'Preferences')
    await preferences(root, 'Default', { disable_reasons: [1] })
    const disabled = await resolveExtensionProfile({ userDataDir: root }).catch((error) => error.message)
    const file = path.join(root, 'Default', 'Secure Preferences')
    await writeFile(file, 'mock-private-preferences-that-are-not-json')
    const invalid = await resolveExtensionProfile({ userDataDir: root }).catch((error) => error.message)
    const traversal = await resolveExtensionProfile({ userDataDir: root, profileDirName: '../Atlas' }).catch(
      (error) => error.message,
    )
    assert({
      given: 'conflicting legacy metadata, unreadable metadata, and an invalid profile path',
      should: 'honor Brave’s current state and report fixed errors without exposing private file contents',
      actual: [
        disabled.includes('disabled'),
        invalid.includes('could not read'),
        invalid.includes('mock-private'),
        traversal,
      ],
      expected: [true, true, false, 'Choose a valid Brave profile.'],
    })
  }))

test('leftover extension packages do not count as an enabled installation', async () =>
  fixture(async (root) => {
    await mkdir(path.join(root, 'Default', 'Extensions', EXTENSION_ID), { recursive: true })
    const failure = await resolveExtensionProfile({ userDataDir: root }).catch((error) => error.message)
    assert({
      given: 'an extension directory left behind without a registered extension',
      should: 'stop before opening a blocked connection page',
      actual: failure.includes('disabled'),
      expected: true,
    })
  }))
