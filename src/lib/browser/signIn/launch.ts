import { mkdir } from 'node:fs/promises'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { ExistingBrowserSettingsStore } from '../existing/settings.ts'
import { McpClient, McpError } from '../mcp/client.ts'
import { browserTaskHost } from '../task/host.ts'
import type { BrowserUploads } from '../task/uploads.ts'
import { SKY_PRIVATE_BROWSER_PROFILE } from './profile.ts'
import type { PrivateBrowserClient } from './run.ts'

/** A separate worker owns provider values and leases Sky's persistent profile. Only safe tool results leave it. */
export async function launchPrivateBrowser(
  options: {
    objective: string
    filesDir: string
    headless?: boolean
    uploads?: BrowserUploads
    background?: boolean
    /** Trusted host/test override; never included in a model tool or worker request. */
    profileDir?: string
  },
  signal?: AbortSignal,
): Promise<PrivateBrowserClient> {
  signal?.throwIfAborted()
  await mkdir(options.filesDir, { recursive: true, mode: 0o700 })
  const environment = { ...process.env }
  const { profileDir, ...request } = options
  environment.SKY_PRIVATE_BROWSER_PROFILE = profileDir ?? SKY_PRIVATE_BROWSER_PROFILE
  // Explicit test profiles stay isolated. Every other task honors the saved browser choice.
  const existing = !profileDir && !options.headless && (await new ExistingBrowserSettingsStore().read())
  if (existing) environment.SKY_USE_EXISTING_BROWSER = '1'
  else delete environment.SKY_USE_EXISTING_BROWSER
  for (const name of Object.keys(environment)) {
    if (/^(DEBUG|PWDEBUG|PLAYWRIGHT_|OP_|BUN_INSPECT|NODE_OPTIONS)/.test(name)) delete environment[name]
  }
  const start = () =>
    McpClient.start({
      command: process.execPath,
      args: [fileURLToPath(new URL('./worker.ts', import.meta.url))],
      cwd: options.filesDir,
      env: environment,
      clientName: 'sky-private-task',
    })
  const host = browserTaskHost.getStore()
  if (host?.browserRun && !profileDir && !options.headless)
    return host.browserRun.acquire(
      start,
      { ...request, runObjective: host.runObjective ?? options.objective },
      signal,
      existing ? 'existing' : 'profile',
    )
  const client = await start()
  try {
    const started = await client.callTool('sky_start', request, { signal })
    if (started.isError) throw new Error('The private browser could not start.')
    return client
  } catch (error) {
    await client.close()
    if (error instanceof McpError && error.code === -32010) throw error
    throw new Error('The private browser could not start.')
  }
}
