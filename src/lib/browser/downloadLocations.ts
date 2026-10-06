import { readFile, readdir, realpath } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import process from 'node:process'
import { ExistingBrowserSettingsStore } from './existing/settings.ts'

export interface DownloadLocation {
  path: string
  sources: string[]
}

export interface DownloadLocations {
  locations: DownloadLocation[]
  configuredDirectories: { profile: string; path: string }[]
  issues: string[]
}

export interface DownloadLocationOptions {
  homeDir?: string
  userDataDir?: string
  profileDirName?: string
  additionalDirectories?: readonly string[]
}

function braveDataDir(home: string): string {
  if (process.platform === 'darwin')
    return path.join(home, 'Library', 'Application Support', 'BraveSoftware', 'Brave-Browser')
  if (process.platform === 'win32')
    return path.join(process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local'), 'BraveSoftware', 'Brave-Browser')
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, '.config'), 'BraveSoftware', 'Brave-Browser')
}

/** Preferences and folder paths only: no browser connection, history, cookies or Keychain access. */
export async function resolveDownloadLocations(options: DownloadLocationOptions = {}): Promise<DownloadLocations> {
  const home = options.homeDir ?? os.homedir()
  const root = options.userDataDir ?? braveDataDir(home)
  const result: DownloadLocations = { locations: [], configuredDirectories: [], issues: [] }
  const add = async (directory: string, source: string) => {
    const location = await realpath(directory).catch(() => path.resolve(directory))
    const existing = result.locations.find((entry) => entry.path === location)
    if (existing) {
      if (!existing.sources.includes(source)) existing.sources.push(source)
    } else result.locations.push({ path: location, sources: [source] })
    return location
  }
  let profiles: string[] = []
  try {
    if (options.profileDirName) {
      if (!/^(Default|Profile \d+)$/.test(options.profileDirName)) throw new Error('Invalid profile')
      profiles = [options.profileDirName]
    } else {
      profiles = (await readdir(root, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && /^(Default|Profile \d+)$/.test(entry.name))
        .map((entry) => entry.name)
        .sort()
      if (!profiles.length)
        result.issues.push('No browser profile preferences were found; standard folders are still checked.')
      if (profiles.length > 1)
        result.issues.push(
          'No browser profile is selected; download folders from every available profile are included.',
        )
    }
  } catch {
    result.issues.push('The browser profile location could not be read; standard folders are still checked.')
  }
  for (const profile of profiles) {
    try {
      const preferences = JSON.parse(await readFile(path.join(root, profile, 'Preferences'), 'utf8'))
      const directory = preferences.download?.default_directory
      if (typeof directory !== 'string' || !path.isAbsolute(directory)) {
        result.issues.push(
          `Browser profile "${profile}" has no explicit download directory; standard folders are included.`,
        )
        continue
      }
      result.configuredDirectories.push({ profile, path: await add(directory, `browser:${profile}`) })
    } catch {
      result.issues.push(`Download preferences for browser profile "${profile}" could not be read.`)
    }
  }
  for (const directory of options.additionalDirectories ?? []) await add(directory, 'requested')
  await add(path.join(home, 'Desktop'), 'desktop')
  await add(path.join(home, 'Downloads'), 'downloads')
  return result
}

/** Read the selected connection's preferences without opening a browser or retrieving its token. */
export async function discoverDownloadLocations(additionalDirectories: readonly string[] = [], homeDir = os.homedir()) {
  const browserRoot = path.join(homeDir, '.sky', 'browser')
  let settings
  let settingsIssue: string | undefined
  try {
    settings = await new ExistingBrowserSettingsStore(path.join(browserRoot, 'connection.json')).read()
  } catch {
    settingsIssue =
      'The saved browser selection could not be read; Brave preferences and standard folders are included.'
  }
  const existingBrowser = !!settings || !!settingsIssue
  const locations = await resolveDownloadLocations({
    homeDir,
    ...(existingBrowser
      ? { profileDirName: settings?.profileDirName }
      : {
          userDataDir: path.join(browserRoot, 'private-profile'),
          profileDirName: 'Default',
        }),
    additionalDirectories: existingBrowser
      ? additionalDirectories
      : [...additionalDirectories, path.join(browserRoot, 'downloads')],
  })
  if (settingsIssue) locations.issues.unshift(settingsIssue)
  return { browser: existingBrowser ? ('brave' as const) : ('sky' as const), ...locations }
}
