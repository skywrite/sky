import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { McpClient } from '../mcp/client.ts'

/** A separate worker owns provider values and its ephemeral browser. Only safe tool results leave it. */
export async function launchPrivateBrowser(
  options: {
    objective: string
    filesDir: string
    headless?: boolean
  },
  signal?: AbortSignal,
): Promise<McpClient> {
  signal?.throwIfAborted()
  const environment = { ...process.env }
  for (const name of Object.keys(environment)) {
    if (/^(DEBUG|PWDEBUG|PLAYWRIGHT_|OP_|BUN_INSPECT|NODE_OPTIONS)/.test(name)) delete environment[name]
  }
  const client = await McpClient.start({
    command: process.execPath,
    args: [fileURLToPath(new URL('./worker.ts', import.meta.url))],
    cwd: options.filesDir,
    env: environment,
    clientName: 'sky-private-task',
  })
  try {
    const started = await client.callTool('sky_start', { ...options }, { signal })
    if (started.isError) throw new Error('The private browser could not start.')
    return client
  } catch {
    await client.close()
    throw new Error('The private browser could not start.')
  }
}
