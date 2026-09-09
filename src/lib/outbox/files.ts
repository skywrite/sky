import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readFile, readlink, rename, stat, symlink, unlink } from 'node:fs/promises'
import * as path from 'node:path'
import process from 'node:process'
import { withProcessLock } from '#lib/jobs/files.ts'
import { OutboxError } from './types.ts'

export const hash = (value: string): string => createHash('sha256').update(value).digest('hex')
export const missing = (error: unknown): boolean => (error as NodeJS.ErrnoException)?.code === 'ENOENT'

export async function readOptional(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8')
  } catch (error) {
    if (missing(error)) return undefined
    throw error
  }
}

export async function atomicWrite(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.${randomUUID()}.tmp`
  const handle = await open(temp, 'wx', 0o600)
  try {
    await handle.writeFile(content, 'utf8')
    await handle.sync()
    await handle.close()
    await rename(temp, file)
  } finally {
    await handle.close()
    await unlink(temp).catch((error: unknown) => {
      if (!missing(error)) throw error
    })
  }
}

/** A scanner may also run from the CLI. Locks live on this machine, outside the synced notebook. */
export async function withLock<T>(file: string, run: () => Promise<T>, wait = true): Promise<T> {
  await mkdir(path.dirname(file), { recursive: true })
  const token = `${process.pid}:${randomUUID()}`
  const readOwner = async (): Promise<string | undefined> => {
    try {
      return await readlink(file)
    } catch (error) {
      if (missing(error)) return undefined
      if ((error as NodeJS.ErrnoException).code === 'EINVAL') return readOptional(file)
      throw error
    }
  }
  for (let attempt = 0; attempt < (wait ? 100 : 2); attempt++) {
    try {
      // The owner and the lock appear atomically, including if the process dies immediately afterwards.
      await symlink(token, file)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const owner = await readOwner()
      if (owner && /^\d+:/.test(owner)) {
        let dead = false
        try {
          process.kill(Number(owner.split(':')[0]), 0)
        } catch (probe) {
          dead = (probe as NodeJS.ErrnoException).code === 'ESRCH'
        }
        if (dead) {
          // Serialize stale-lock cleanup: a second reaper must re-read after
          // the first removes the dead owner and a new scanner acquires it.
          await withProcessLock(`${file}.reap`, async () => {
            if ((await readOwner()) !== owner) return
            await unlink(file).catch((problem: unknown) => {
              if (!missing(problem)) throw problem
            })
          })
          continue
        }
      }
      if (!wait) break
      await new Promise((resolve) => setTimeout(resolve, 25))
      continue
    }
    try {
      return await run()
    } finally {
      if ((await readOwner()) === token) await unlink(file)
    }
  }
  throw new OutboxError('Outbox is already working. Try again in a moment.', 409)
}

/** Refuse symlinks and traversal before reading message paths supplied by saved content. */
export async function notebookFile(root: string, relative: string): Promise<string> {
  const absolute = path.resolve(root, relative)
  const rel = path.relative(root, absolute)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new OutboxError('Invalid notebook path.')
  let cursor = root
  for (const part of rel.split(path.sep)) {
    cursor = path.join(cursor, part)
    if ((await lstat(cursor)).isSymbolicLink()) throw new OutboxError('Outbox does not follow symbolic links.')
  }
  if (!(await stat(absolute)).isFile()) throw new OutboxError('Expected a saved message file.')
  return absolute
}
