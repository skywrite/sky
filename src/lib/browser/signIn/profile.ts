import { chmod, mkdir, readFile, unlink } from 'node:fs/promises'
import * as path from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import type { BrowserContext } from 'playwright'
import { z } from 'zod'
import { isProcessAlive, missing, readJson, withProcessLock, writeJson } from '#lib/jobs/files.ts'
import { clearDownloadBookkeeping, SKY_BROWSER_DIR } from '../mcp/browserDriver.ts'
import { clearProfileLock, quietProfilePreferences } from '../persistentContext.ts'

// Browser state stays local to this Mac, outside the notebook and its potentially synced data directory.
export const SKY_PRIVATE_BROWSER_PROFILE = path.join(SKY_BROWSER_DIR, 'private-profile')

const cookiesSchema = z.object({
  version: z.literal(1),
  cookies: z.array(
    z.object({
      name: z.string(),
      value: z.string(),
      domain: z.string(),
      path: z.string(),
      expires: z.literal(-1),
      httpOnly: z.boolean(),
      secure: z.boolean(),
      sameSite: z.enum(['Strict', 'Lax', 'None']),
      partitionKey: z.string().optional(),
    }),
  ),
})

export class BrowserProfileError extends Error {
  constructor(message: string) {
    super(message)
  }
}

/** One worker at a time owns this profile. A crashed worker's lease is reclaimed without deleting browser data. */
export async function acquireBrowserProfile(
  directory: string,
  signal?: AbortSignal,
  waitMs = 90_000,
): Promise<() => Promise<void>> {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await chmod(directory, 0o700)
  const lease = path.join(directory, 'sky-owner.json')
  const mutex = path.join(directory, 'sky-owner.lock')
  const token = crypto.randomUUID()
  const started = performance.now()
  for (;;) {
    signal?.throwIfAborted()
    const acquired = await withProcessLock(mutex, async () => {
      signal?.throwIfAborted()
      const owner = await readJson<{ pid: number; token: string }>(lease)
      if (owner && isProcessAlive(owner.pid)) return false
      await writeJson(lease, { pid: process.pid, token })
      return true
    })
    if (acquired)
      return () =>
        withProcessLock(mutex, async () => {
          const owner = await readJson<{ token: string }>(lease)
          if (owner?.token === token) await unlink(lease)
        })
    if (performance.now() - started >= waitMs)
      throw new BrowserProfileError(
        'Sky’s browser is still being used by another task. This task has not opened a browser. Try again when the other task finishes; your sign-ins are saved.',
      )
    await delay(Math.min(250, Math.max(1, waitMs)), undefined, { signal })
  }
}

export async function prepareBrowserProfile(directory: string): Promise<void> {
  // This is Sky's dedicated profile, protected by its lease. A live Chromium here can only be an orphan.
  await clearProfileLock(directory, true)
  await clearDownloadBookkeeping(directory)
  await quietProfilePreferences(directory)
}

/** The profile retains persistent cookies and site storage. Chromium needs help restoring session-only cookies. */
export class BrowserSessionCookies {
  private readonly file: string
  private writes = Promise.resolve()

  constructor(directory: string) {
    this.file = path.join(directory, 'sky-session-cookies.json')
  }

  async restore(context: BrowserContext): Promise<void> {
    let raw: string
    try {
      raw = await readFile(this.file, 'utf8')
    } catch (error) {
      if (missing(error)) return
      throw new BrowserProfileError('Sky could not read its saved browser session. The profile has been preserved.')
    }
    try {
      const saved = cookiesSchema.parse(JSON.parse(raw))
      await context.addCookies(saved.cookies)
    } catch {
      // Parse errors and browser errors can include cookie values. Never report their contents.
      throw new BrowserProfileError('Sky could not restore its saved browser session. The profile has been preserved.')
    }
  }

  save(context: BrowserContext): Promise<void> {
    const next = this.writes
      .catch(() => {})
      .then(async () => {
        try {
          const cookies = (await context.cookies()).filter((cookie) => cookie.expires === -1)
          // Kept in the private profile, outside task artifacts. Atomic replacement also records explicit sign-out.
          await writeJson(this.file, { version: 1, cookies })
        } catch {
          throw new BrowserProfileError(
            'Sky could not save the latest browser session. The existing profile has been preserved.',
          )
        }
      })
    this.writes = next
    return next
  }
}
