import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { withProcessLock } from '#lib/jobs/files.ts'
import { TrackingError } from './types.ts'

export const fingerprint = (value: string): string => createHash('sha256').update(value).digest('hex')
export const missingFile = (error: unknown): boolean => (error as NodeJS.ErrnoException)?.code === 'ENOENT'

export async function readTrackingFile(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8')
  } catch (error) {
    if (missingFile(error)) return null
    throw error
  }
}

export async function safeTrackingPath(root: string, relative: string): Promise<string> {
  const file = path.resolve(root, relative)
  const rel = path.relative(root, file)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new TrackingError('Invalid tracking path.')
  let cursor = root
  for (const segment of rel.split(path.sep)) {
    cursor = path.join(cursor, segment)
    try {
      if ((await lstat(cursor)).isSymbolicLink()) throw new TrackingError('Tracking does not follow symbolic links.')
    } catch (error) {
      if (!missingFile(error)) throw error
    }
  }
  return file
}

export async function writeTrackingFile(file: string, contents: string | null): Promise<void> {
  if (contents === null) {
    await unlink(file).catch((error) => {
      if (!missingFile(error)) throw error
    })
    return
  }
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  const handle = await open(temporary, 'wx', 0o600)
  try {
    await handle.writeFile(contents, 'utf8')
    await handle.sync()
    await handle.close()
    await rename(temporary, file)
  } finally {
    await handle.close()
    await unlink(temporary).catch((error) => {
      if (!missingFile(error)) throw error
    })
  }
}

/** The CLI and web writer take the same locks, outside the synced notebook. */
export async function withTrackingFiles<T>(files: string[], run: () => Promise<T>): Promise<T> {
  const ordered = [...new Set(files.map((file) => path.resolve(file)))].sort()
  const lock = (index: number): Promise<T> =>
    index === ordered.length
      ? run()
      : withProcessLock(path.join(tmpdir(), 'sky-tracking-locks', fingerprint(ordered[index])), () => lock(index + 1))
  return lock(0)
}
