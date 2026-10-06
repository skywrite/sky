import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import type { BrowserContext } from 'playwright'
import { assert, test } from '#test'
import { acquireBrowserProfile, BrowserProfileError, BrowserSessionCookies } from './profile.ts'

test('a persistent profile waits its turn, supports cancellation, and rejects a stale release', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-profile-lease-'))
  const releases: Array<() => Promise<void>> = []
  try {
    const first = await acquireBrowserProfile(root)
    releases.push(first)
    const controller = new AbortController()
    const waiting = acquireBrowserProfile(root, controller.signal).then(
      () => 'acquired',
      () => 'cancelled',
    )
    controller.abort()
    assert({
      given: 'an aborted waiter',
      should: 'leave the active profile alone',
      actual: await waiting,
      expected: 'cancelled',
    })
    const next = acquireBrowserProfile(root)
    await first()
    releases.push(await next)
    await first()
    const busy = await acquireBrowserProfile(root, undefined, 0).then(
      (release) => {
        releases.push(release)
        return false
      },
      (error) => error instanceof BrowserProfileError,
    )
    assert({
      given: 'the prior owner releases twice after the next run starts',
      should: 'retain the new owner’s lease',
      actual: busy,
      expected: true,
    })
  } finally {
    for (const release of releases.reverse()) await release()
    await rm(root, { recursive: true, force: true })
  }
})

test('a dead browser worker is replaced without deleting its saved data', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-profile-recovery-'))
  try {
    await writeFile(
      path.join(root, 'sky-owner.json'),
      JSON.stringify({ pid: 2147483647, token: 'synthetic-old-owner' }),
    )
    await writeFile(path.join(root, 'saved-session'), 'synthetic session marker')
    const release = await acquireBrowserProfile(root)
    try {
      assert({
        given: 'a lease left by a dead worker',
        should: 'retain the profile when reclaiming ownership',
        actual: await readFile(path.join(root, 'saved-session'), 'utf8'),
        expected: 'synthetic session marker',
      })
    } finally {
      await release()
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('invalid saved cookies are preserved and reported without their values', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-profile-corrupt-'))
  try {
    const file = path.join(root, 'sky-session-cookies.json')
    const contents = '{"synthetic-private-token":'
    await writeFile(file, contents)
    const error = await new BrowserSessionCookies(root).restore({} as BrowserContext).then(
      () => null,
      (error) => error,
    )
    assert({
      given: 'an unreadable saved session',
      should: 'report a fixed error and preserve the existing file for recovery',
      actual: [
        error instanceof BrowserProfileError,
        String(error).includes('synthetic-private-token'),
        await readFile(file, 'utf8'),
      ],
      expected: [true, false, contents],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
