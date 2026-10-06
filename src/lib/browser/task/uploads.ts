import { constants } from 'node:fs'
import { mkdir, open, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { secureOrigin } from '#lib/credentials/login.ts'

export interface BrowserUploads {
  origin: string
  files: Array<{ path: string; name: string }>
}

/** Stage exactly the caller's files before opening the browser; page text cannot expand this list. */
export async function prepareBrowserUploads(paths: string[], origin: string, taskDir: string): Promise<BrowserUploads> {
  const destination = secureOrigin(origin)
  if (!destination || origin.replace(/\/$/, '') !== destination)
    throw new Error('Uploads need an exact HTTPS destination origin, with no path, query, or credentials.')
  if (!paths.length || paths.length > 50) throw new Error('Choose between one and fifty files to upload.')
  const dir = path.join(taskDir, 'uploads')
  await mkdir(dir, { mode: 0o700 })
  let total = 0
  const files: BrowserUploads['files'] = []
  for (const [index, source] of paths.entries()) {
    if (!path.isAbsolute(source)) throw new Error('Upload files must have absolute paths.')
    const file = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const info = await file.stat()
      total += info.size
      if (!info.isFile() || info.size > 20 * 1024 * 1024 || total > 100 * 1024 * 1024)
        throw new Error('Upload regular files up to 20 MB each and 100 MB in total.')
      const bytes = await file.readFile()
      if (bytes.length !== info.size)
        throw new Error('An upload file changed while it was being prepared. Check it and try again.')
      const name = path.basename(source)
      const copy = path.join(dir, `${index + 1}-${name}`)
      await writeFile(copy, bytes, { mode: 0o600, flag: 'wx' })
      files.push({ path: copy, name })
    } finally {
      await file.close()
    }
  }
  return { origin: destination, files }
}
