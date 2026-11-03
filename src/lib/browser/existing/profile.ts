import { access, readFile, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import * as path from 'node:path'
import process from 'node:process'
import { EXTENSION_ID, ExistingBrowserError } from './settings.ts'

const PROFILE = /^(Default|Profile \d+)$/
// Chromium persists these disable reasons as bit flags, sometimes in an array.
const DISABLE_CORRUPTED = 1 << 10

interface ExtensionRecord {
  state?: number
  disable_reasons?: number | number[]
}

export function braveUserDataDir(home = homedir()): string {
  if (process.platform === 'darwin')
    return path.join(home, 'Library', 'Application Support', 'BraveSoftware', 'Brave-Browser')
  if (process.platform === 'win32')
    return path.join(process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local'), 'BraveSoftware', 'Brave-Browser')
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, '.config'), 'BraveSoftware', 'Brave-Browser')
}

async function readJson(file: string): Promise<Record<string, unknown> | undefined> {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw new ExistingBrowserError(
      'Sky could not read Brave’s extension settings. Open Brave, then reconnect in Settings → Browser automation. Your browser task has not started.',
    )
  }
}

async function extensionRecord(profile: string): Promise<ExtensionRecord | undefined> {
  // Current Brave stores extension state here; older profiles may use Preferences.
  for (const filename of ['Secure Preferences', 'Preferences']) {
    const preferences = await readJson(path.join(profile, filename))
    const extensions = preferences?.extensions as { settings?: Record<string, unknown> } | undefined
    const record = extensions?.settings?.[EXTENSION_ID]
    if (record && typeof record === 'object') return record as ExtensionRecord
  }
  return undefined
}

/** Metadata only: reject disabled extensions before opening a token-bearing extension URL. */
export async function resolveExtensionProfile(
  options: {
    profileDirName?: string
    userDataDir?: string
    homeDir?: string
  } = {},
): Promise<string> {
  const root = options.userDataDir ?? braveUserDataDir(options.homeDir)
  const selected = options.profileDirName
  if (selected && !PROFILE.test(selected)) throw new ExistingBrowserError('Choose a valid Brave profile.')
  let profiles: string[]
  try {
    profiles = selected ? [selected] : (await readdir(root)).filter((entry) => PROFILE.test(entry))
  } catch {
    profiles = []
  }
  profiles.sort((a, b) => (a === 'Default' ? -1 : b === 'Default' ? 1 : Number(a.slice(8)) - Number(b.slice(8))))
  if (!selected) {
    const state = await readJson(path.join(root, 'Local State'))
    const lastUsed = (state?.profile as { last_used?: unknown } | undefined)?.last_used
    if (typeof lastUsed === 'string' && profiles.includes(lastUsed))
      profiles = [lastUsed, ...profiles.filter((profile) => profile !== lastUsed)]
  }
  for (const profile of profiles) {
    const directory = path.join(root, profile)
    const record = await extensionRecord(directory)
    if (!record) {
      const installed = await access(path.join(directory, 'Extensions', EXTENSION_ID)).then(
        () => true,
        () => false,
      )
      if (!installed) continue
    }
    const reasons = Array.isArray(record?.disable_reasons)
      ? record.disable_reasons
      : typeof record?.disable_reasons === 'number'
        ? [record.disable_reasons]
        : []
    if (reasons.some((reason) => (reason & DISABLE_CORRUPTED) !== 0))
      throw new ExistingBrowserError(
        'Brave disabled Microsoft’s Playwright Extension because it detected corruption. Repair the extension in brave://extensions, then update its connection token in Settings → Browser automation. Your browser task has not started.',
      )
    if (!record || (record.state !== undefined && record.state !== 1) || reasons.some((reason) => reason !== 0))
      throw new ExistingBrowserError(
        'Microsoft’s Playwright Extension is disabled in the selected Brave profile. Enable it in brave://extensions, then retry. You can manage the connection in Settings → Browser automation. Your browser task has not started.',
      )
    // Do not skip a disabled profile and silently connect to another browser identity.
    return profile
  }
  throw new ExistingBrowserError(
    'Microsoft’s Playwright Extension is missing from the selected Brave profile. Connect Brave in Settings → Browser automation, or choose Sky’s separate browser. Your browser task has not started.',
  )
}
