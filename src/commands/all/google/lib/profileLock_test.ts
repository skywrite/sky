import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import process from 'node:process'
import { assert, test } from '#test'
import { ProfileLockBusyError, acquireProfileLock } from './profileLock.ts'

// A pid that cannot exist: macOS caps pids at 99998, Linux at 4194304.
const DEAD_PID = 4194305

const scratchDir = path.join(os.tmpdir(), `sky-profile-lock-test-${process.pid}`)

async function withLockPath(name: string, fn: (lockPath: string) => Promise<void>): Promise<void> {
  await mkdir(scratchDir, { recursive: true })
  const lockPath = path.join(scratchDir, name)
  try {
    await fn(lockPath)
  } finally {
    await rm(lockPath, { force: true }).catch(() => undefined)
  }
}

test('acquireProfileLock', { timeout: 15_000 }, async () => {
  await withLockPath('plain.lock', async (lockPath) => {
    const release = await acquireProfileLock(lockPath)
    assert({
      given: 'an uncontended acquire',
      should: 'hold the lock as this process',
      expected: String(process.pid),
      actual: await readFile(lockPath, 'utf8'),
    })
    await release()
    assert({
      given: 'a release',
      should: 'remove the lock file',
      expected: null,
      actual: await readFile(lockPath, 'utf8').catch(() => null),
    })
  })

  await withLockPath('busy.lock', async (lockPath) => {
    const release = await acquireProfileLock(lockPath)
    const outcome = await acquireProfileLock(lockPath, { deadlineMs: 60, pollMs: 20 }).then(
      () => 'acquired',
      (err) => (err instanceof ProfileLockBusyError ? 'busy' : 'unexpected'),
    )
    await release()
    assert({
      given: 'a live holder and an expired deadline',
      should: 'throw the busy error, not steal',
      expected: 'busy',
      actual: outcome,
    })
  })

  await withLockPath('stale.lock', async (lockPath) => {
    await writeFile(lockPath, String(DEAD_PID))
    const release = await acquireProfileLock(lockPath, { deadlineMs: 60, pollMs: 20 })
    assert({
      given: 'a lock held by a dead pid',
      should: 'steal it without waiting out the deadline',
      expected: String(process.pid),
      actual: await readFile(lockPath, 'utf8'),
    })
    await release()
  })

  await withLockPath('garbage.lock', async (lockPath) => {
    await writeFile(lockPath, 'not-a-pid')
    const release = await acquireProfileLock(lockPath, { deadlineMs: 60, pollMs: 20 })
    assert({
      given: 'an unreadable holder',
      should: 'treat it as stale and take over',
      expected: String(process.pid),
      actual: await readFile(lockPath, 'utf8'),
    })
    await release()
  })

  await withLockPath('foreign.lock', async (lockPath) => {
    const release = await acquireProfileLock(lockPath)
    await writeFile(lockPath, String(DEAD_PID))
    await release()
    assert({
      given: 'a lock this process no longer owns',
      should: 'leave it in place on release',
      expected: String(DEAD_PID),
      actual: await readFile(lockPath, 'utf8'),
    })
  })
})
