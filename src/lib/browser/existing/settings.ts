import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { z } from 'zod'
import { DIR_HOME } from '#config'
import { createSecret, KeychainSecretsProvider, type SecretsProvider } from '#lib/secrets/mod.ts'

export const EXISTING_BROWSER_FILE = path.join(DIR_HOME, '.sky', 'browser', 'connection.json')
export const EXTENSION_URL =
  'https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm'
const schema = z
  .object({
    browser: z.literal('brave'),
    profileDirName: z
      .string()
      .regex(/^(Default|Profile \d+)$/)
      .optional(),
  })
  .strict()
export type ExistingBrowserSettings = z.infer<typeof schema>

export class ExistingBrowserError extends Error {}

/** The connection grant is in Keychain; this machine-local file contains preferences only. */
export class ExistingBrowserSettingsStore {
  constructor(
    readonly file = EXISTING_BROWSER_FILE,
    private readonly secrets: SecretsProvider = new KeychainSecretsProvider(),
  ) {}

  async read(): Promise<ExistingBrowserSettings | undefined> {
    try {
      return schema.parse(JSON.parse(await readFile(this.file, 'utf8')))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw new ExistingBrowserError(
        'The saved Brave connection could not be read. Reconnect Brave in Settings → Browser automation.',
      )
    }
  }

  async token(): Promise<string> {
    try {
      const saved = await this.secrets.get('browser', 'playwright-extension')
      if (saved?.type === 'secret' && /^[A-Za-z0-9_-]{32,256}$/.test(saved.val)) return saved.val
    } catch {
      throw new ExistingBrowserError(
        'Sky could not read its Brave connection from Keychain. Restore Keychain access in Settings → Connections, then retry.',
      )
    }
    throw new ExistingBrowserError(
      'The Brave connection token is missing. Reconnect Brave in Settings → Browser automation.',
    )
  }

  async connect(token: string, settings: ExistingBrowserSettings = { browser: 'brave' }): Promise<void> {
    const value = token.trim().replace(/^PLAYWRIGHT_MCP_EXTENSION_TOKEN=/, '')
    if (!/^[A-Za-z0-9_-]{32,256}$/.test(value))
      throw new ExistingBrowserError('Paste the connection token shown by the Playwright extension in Brave.')
    const parsed = schema.parse(settings)
    await this.secrets.set('browser', 'playwright-extension', createSecret(value))
    await this.enable(parsed)
  }

  async enable(settings: ExistingBrowserSettings): Promise<void> {
    const parsed = schema.parse(settings)
    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 })
    const temporary = `${this.file}.${crypto.randomUUID()}.tmp`
    try {
      await writeFile(temporary, JSON.stringify(parsed), { mode: 0o600, flag: 'wx' })
      await rename(temporary, this.file)
      await chmod(this.file, 0o600)
    } finally {
      await rm(temporary, { force: true })
    }
  }

  async disconnect(): Promise<void> {
    // Stop selecting this connection even if Keychain is temporarily unavailable.
    await rm(this.file, { force: true })
    await this.secrets.delete('browser', 'playwright-extension')
  }
}
