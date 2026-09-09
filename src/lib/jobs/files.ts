import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, readlink, rename, symlink, unlink } from 'node:fs/promises'
import * as path from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'

export const missing = (error: unknown): boolean => (error as NodeJS.ErrnoException)?.code === 'ENOENT'

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

export async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T
  } catch (error) {
    if (missing(error)) return null
    throw error
  }
}

export async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  const handle = await open(temporary, 'wx', 0o600)
  try {
    await handle.writeFile(JSON.stringify(value), 'utf8')
    await handle.sync()
    await handle.close()
    await rename(temporary, file)
  } finally {
    await handle.close()
    await unlink(temporary).catch((error: unknown) => {
      if (!missing(error)) throw error
    })
  }
}

/** Short cross-process transactions. The directory must be local to this machine. */
export async function withProcessLock<T>(dir: string, run: () => Promise<T>): Promise<T> {
  await mkdir(dir, { recursive: true })
  const token = `${process.pid}:${randomUUID()}`
  let file = path.join(dir, 'owner')
  const readOwner = async (entry: string): Promise<string | null> =>
    readlink(entry).catch((error: unknown) => {
      if (missing(error)) return null
      throw error
    })
  for (let attempt = 0; attempt < 400; attempt++) {
    try {
      // The owner appears atomically, even if the process dies immediately afterwards.
      await symlink(token, file)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const owner = await readOwner(file)
      if (!owner) continue
      if (!/^\d+:[a-f0-9-]+$/.test(owner)) throw new Error('Invalid process lock owner.')
      const successor = path.join(dir, createHash('sha256').update(owner).digest('hex'))
      const retired = `${successor}.retired`
      if ((await readOwner(retired)) === owner || !isProcessAlive(Number(owner.split(':')[0]))) {
        // Never unlink a stale lock: two reapers could delete a new owner's lock.
        // Its immutable token instead selects one shared successor for all contenders.
        // Re-read after the death probe: the old owner may have released before exiting.
        if ((await readOwner(file)) !== owner) continue
        await symlink(owner, retired).catch((problem: unknown) => {
          if ((problem as NodeJS.ErrnoException).code !== 'EEXIST') throw problem
        })
        file = successor
        continue
      }
      await delay(25)
      continue
    }
    try {
      return await run()
    } finally {
      await unlink(file)
    }
  }
  throw new Error('Background job state is busy. Try again in a moment.')
}
