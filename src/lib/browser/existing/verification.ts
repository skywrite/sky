import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { McpClient, McpError } from '../mcp/client.ts'
import {
  connectionToken,
  ExistingBrowserError,
  existingBrowserSettingsSchema,
  type ExistingBrowserSettings,
} from './settings.ts'

async function startWorker(): Promise<Pick<McpClient, 'callTool' | 'close'>> {
  const environment = { ...process.env }
  for (const name of Object.keys(environment)) {
    if (/^(DEBUG|PWDEBUG|PLAYWRIGHT_|OP_|BUN_INSPECT|NODE_OPTIONS)/.test(name)) delete environment[name]
  }
  return McpClient.start({
    command: process.execPath,
    args: [fileURLToPath(new URL('../signIn/worker.ts', import.meta.url))],
    env: environment,
    clientName: 'sky-browser-setup',
  })
}

/** Explicit setup only. Verify an owned blank tab in a worker before replacing the saved connection grant. */
export async function verifyExistingBrowser(
  token: string,
  settings: ExistingBrowserSettings,
  start = startWorker,
): Promise<ExistingBrowserSettings> {
  const value = connectionToken(token)
  const candidate = existingBrowserSettingsSchema.parse(settings)
  let client: Pick<McpClient, 'callTool' | 'close'> | undefined
  try {
    client = await start()
    // The token travels only over inherited pipes, never in argv, a URL returned to Settings, or model tools.
    const result = await client.callTool(
      'sky_verify_existing_browser',
      { token: value, settings: candidate },
      { timeoutMs: 45_000 },
    )
    if (result.isError) throw new Error('Verification failed')
    const verified = existingBrowserSettingsSchema.parse(result.structuredContent)
    if (!verified.profileDirName || (candidate.profileDirName && candidate.profileDirName !== verified.profileDirName))
      throw new Error('Unexpected browser profile')
    return verified
  } catch (error) {
    if (error instanceof McpError && error.code === -32010)
      throw new ExistingBrowserError(error.message.replaceAll(value, '[redacted]'))
    throw new ExistingBrowserError(
      'Sky could not verify this Brave connection. Use the current token from the Playwright Extension and try again. Your saved browser connection has not changed.',
    )
  } finally {
    await client?.close()
  }
}
