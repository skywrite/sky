import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import process from 'node:process'
import { assert, test } from '#test'
import { discoverDownloadLocations, resolveDownloadLocations } from './downloadLocations.ts'

async function fixture(work: (root: string) => Promise<void>) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'sky-download-locations-')))
  try {
    await work(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function preference(root: string, profile: string, directory: string) {
  await mkdir(path.join(root, profile), { recursive: true })
  await writeFile(
    path.join(root, profile, 'Preferences'),
    JSON.stringify({ download: { default_directory: directory } }),
  )
}

test('download discovery combines configured, task, destination and standard folders without duplicate aliases', async () =>
  fixture(async (root) => {
    const browser = path.join(root, 'browser')
    const desktop = path.join(root, 'Desktop')
    await mkdir(desktop)
    const alias = path.join(root, 'alias')
    await symlink(desktop, alias)
    await preference(browser, 'Default', alias)
    const directories = [path.join(root, 'task'), path.join(root, 'destination'), desktop]
    const result = await resolveDownloadLocations({
      homeDir: root,
      userDataDir: browser,
      additionalDirectories: directories,
    })
    assert({
      given: 'a profile configured to save to a Desktop alias and two requested destinations',
      should: 'resolve the preference and check each physical folder exactly once',
      actual: [result.locations, result.configuredDirectories, result.issues],
      expected: [
        [
          { path: desktop, sources: ['browser:Default', 'requested', 'desktop'] },
          { path: directories[0], sources: ['requested'] },
          { path: directories[1], sources: ['requested'] },
          { path: path.join(root, 'Downloads'), sources: ['downloads'] },
        ],
        [{ profile: 'Default', path: desktop }],
        [],
      ],
    })
  }))

test('download discovery respects a selected profile and checks all profiles when none is specified', async () =>
  fixture(async (root) => {
    const browser = path.join(root, 'browser')
    const first = path.join(root, 'first')
    const second = path.join(root, 'second')
    await preference(browser, 'Default', first)
    await preference(browser, 'Profile 2', second)
    const selected = await resolveDownloadLocations({
      homeDir: root,
      userDataDir: browser,
      profileDirName: 'Profile 2',
    })
    const all = await resolveDownloadLocations({ homeDir: root, userDataDir: browser })
    const invalid = await resolveDownloadLocations({
      homeDir: root,
      userDataDir: browser,
      profileDirName: '../elsewhere',
    })
    assert({
      given: 'two profiles with separate custom folders that have not been created yet',
      should: 'preserve both candidate locations when ambiguous without reading outside the profiles root',
      actual: [
        selected.configuredDirectories,
        all.configuredDirectories,
        all.issues.length,
        invalid.configuredDirectories,
        invalid.locations.length,
        invalid.issues.length,
      ],
      expected: [
        [{ profile: 'Profile 2', path: second }],
        [
          { profile: 'Default', path: first },
          { profile: 'Profile 2', path: second },
        ],
        1,
        [],
        2,
        1,
      ],
    })
  }))

test('missing or malformed preferences never prevent checking standard and requested folders', async () =>
  fixture(async (root) => {
    const browser = path.join(root, 'browser')
    for (const content of [undefined, '{invalid', JSON.stringify({ download: { default_directory: 'relative' } })]) {
      if (content !== undefined) {
        await mkdir(path.join(browser, 'Default'), { recursive: true })
        await writeFile(path.join(browser, 'Default', 'Preferences'), content)
      }
      const result = await resolveDownloadLocations({
        homeDir: root,
        userDataDir: browser,
        additionalDirectories: [path.join(root, 'task')],
      })
      assert({
        given: content === undefined ? 'no browser profile' : 'unusable browser preferences',
        should: 'explain the preference problem and preserve all fallback locations',
        actual: [
          result.locations.map((entry) => path.basename(entry.path)),
          result.issues.length > 0,
          result.configuredDirectories,
        ],
        expected: [['task', 'Desktop', 'Downloads'], true, []],
      })
    }
  }))

test('chat discovery reads the selected browser configuration without connecting or reading a token', async () =>
  fixture(async (root) => {
    const skyRoot = path.join(root, '.sky', 'browser')
    await preference(path.join(skyRoot, 'private-profile'), 'Default', path.join(root, 'SkyFiles'))
    const sky = await discoverDownloadLocations([], root)
    const braveRoot =
      process.platform === 'darwin'
        ? path.join(root, 'Library', 'Application Support', 'BraveSoftware', 'Brave-Browser')
        : process.platform === 'win32'
          ? path.join(process.env.LOCALAPPDATA ?? path.join(root, 'AppData', 'Local'), 'BraveSoftware', 'Brave-Browser')
          : path.join(process.env.XDG_CONFIG_HOME ?? path.join(root, '.config'), 'BraveSoftware', 'Brave-Browser')
    // Test homes must not be redirected to a machine's real profile by environment overrides.
    if (!path.relative(root, braveRoot).startsWith('..')) {
      await preference(braveRoot, 'Profile 2', path.join(root, 'BraveFiles'))
      await writeFile(
        path.join(skyRoot, 'connection.json'),
        JSON.stringify({ browser: 'brave', profileDirName: 'Profile 2' }),
      )
      const brave = await discoverDownloadLocations([], root)
      assert({
        given: 'a saved selection of an existing browser profile with a custom download folder',
        should: 'obtain its location directly from preferences without needing the extension token',
        actual: [brave.browser, brave.configuredDirectories],
        expected: ['brave', [{ profile: 'Profile 2', path: path.join(root, 'BraveFiles') }]],
      })
    }
    assert({
      given: 'Sky’s persistent browser selected by default',
      should: 'include its own configured location and driver landing folder',
      actual: [
        sky.browser,
        sky.configuredDirectories,
        sky.locations.some((entry) => entry.path === path.join(skyRoot, 'downloads')),
      ],
      expected: ['sky', [{ profile: 'Default', path: path.join(root, 'SkyFiles') }], true],
    })
  }))
