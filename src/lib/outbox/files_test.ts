import { mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { assert, test } from '#test'
import { withLock } from './files.ts'
import { OutboxError } from './types.ts'

test('overlapping retries of a dead scanner preserve the new owner lock', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sky-outbox-lock-test-'))
  const file = path.join(dir, 'scan.lock')
  try {
    await symlink('2147483647:synthetic-dead-owner', file)
    let producers = 0
    let settled = 0
    let release!: () => void
    const hold = new Promise<void>((resolve) => {
      release = resolve
    })
    const pending = Promise.allSettled(
      Array.from({ length: 8 }, () =>
        withLock(
          file,
          async () => {
            producers++
            await hold
          },
          false,
        ).finally(() => {
          settled++
        }),
      ),
    )
    for (let attempt = 0; settled < 7 && producers <= 1 && attempt < 100; attempt++) await delay(10)
    release()
    const attempts = await pending
    assert({
      given: 'several clients discover the same dead scanner',
      should: 'start one producer and refuse duplicates without deleting its lock',
      actual: [
        producers,
        attempts.filter(
          (result) =>
            result.status === 'rejected' && result.reason instanceof OutboxError && result.reason.status === 409,
        ).length,
      ],
      expected: [1, 7],
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
