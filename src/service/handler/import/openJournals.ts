import { runCommand } from '#lib/sys/mod.ts'

/** Launch each saved journal through the OS so browser popup limits do not drop results. */
export async function openJournals(files: string[], port: number, run = runCommand): Promise<void> {
  const paths = [...new Set(files)]
  if (!paths.length || paths.some((file) => file.split('/').some((part) => !part || part === '.' || part === '..')))
    throw new Error('There are no valid saved journals to open.')
  // Use the configured local service, never a URL or host supplied by the browser.
  const urls = paths.map(
    (file) => `http://localhost:${port}/explorer/${file.split('/').map(encodeURIComponent).join('/')}`,
  )
  const result = await run('open', urls, { timeout: 10_000 })
  if (!result.success) throw new Error('The journals were saved, but their browser tabs could not be opened.')
}
