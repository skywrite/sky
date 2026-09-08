import { readFile, rm, writeFile } from 'node:fs/promises'
import process from 'node:process'

// Cross-process turn-taking for the automation browser profile. Chromium
// allows one process per profile dir, and the in-process queue in
// browserSession.ts only serializes flows within one sky process — separate
// processes (a terminal command vs another session's mission) would still
// collide. An O_EXCL pidfile makes them wait their turn instead: exactly one
// process creates the file, and a holder that died leaves a stale pid the
// next acquirer deletes — the same liveness self-healing Chromium's own
// SingletonLock check uses. Clock-free by design: staleness is pid-liveness,
// never file age. The microscopic create-vs-read race (a reader seeing the
// file before its pid is flushed treats it as stale) can at worst produce a
// double launch, which Chromium's SingletonLock backstop turns into a clean
// error — the pre-lock status quo.

const DEFAULT_DEADLINE_MS = 120_000
const DEFAULT_POLL_MS = 1000

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export class ProfileLockBusyError extends Error {
  constructor(pid: number, waitedMs: number) {
    super(
      `The automation browser is busy in another sky process (pid ${pid}) — waited ${Math.round(waitedMs / 1000)}s. Retry when it finishes, or: kill ${pid}`,
    )
    this.name = 'ProfileLockBusyError'
  }
}

export interface ProfileLockOptions {
  /** Total time to wait on a live holder before throwing (default 120s — under the agent's 180s tool timer). */
  deadlineMs?: number
  /** Poll interval while waiting (default 1s). */
  pollMs?: number
  /** Fires once, with the holder's pid, when the acquire first starts waiting on a live holder. */
  onWait?: (holderPid: number) => void
}

/**
 * Acquire the profile lock, waiting for a live holder up to the deadline.
 * Resolves to a release function; releasing never removes a lock this
 * process no longer owns.
 */
export async function acquireProfileLock(
  lockPath: string,
  options: ProfileLockOptions = {},
): Promise<() => Promise<void>> {
  const deadlineMs = options.deadlineMs ?? DEFAULT_DEADLINE_MS
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS
  let waitedMs = 0
  let notified = false
  for (;;) {
    try {
      await writeFile(lockPath, String(process.pid), { flag: 'wx' })
      return async () => {
        const holder = await readFile(lockPath, 'utf8').catch(() => null)
        if (holder !== null && Number.parseInt(holder, 10) !== process.pid) return
        await rm(lockPath, { force: true }).catch(() => undefined)
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    }
    const holderRaw = await readFile(lockPath, 'utf8').catch(() => null)
    const holderPid = holderRaw === null ? Number.NaN : Number.parseInt(holderRaw, 10)
    if (!Number.isFinite(holderPid) || !isProcessAlive(holderPid)) {
      // Dead or unreadable holder: clear it and let O_EXCL re-arbitrate
      // among however many waiters saw the same staleness.
      await rm(lockPath, { force: true }).catch(() => undefined)
      continue
    }
    if (waitedMs >= deadlineMs) throw new ProfileLockBusyError(holderPid, waitedMs)
    if (!notified) {
      notified = true
      options.onWait?.(holderPid)
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs))
    waitedMs += pollMs
  }
}
