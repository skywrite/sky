import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { assert, test } from '#test'
import { gatedKeychainAttempt, keychainBackoff } from './keychainGate.ts'
import type { KeychainRequest } from './keychainProtocol.ts'

test('Keychain gate persists denial across callers and requires explicit recovery', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sky-keychain-gate-'))
  const request: KeychainRequest = { operation: 'get', service: 'sky-test', account: 'main', stateDir: dir }
  let calls = 0
  try {
    const denied = await gatedKeychainAttempt(
      request,
      () => {
        calls++
        return { ok: false, kind: 'access', status: -25308 }
      },
      () => 100,
    )
    const paused = await gatedKeychainAttempt(
      request,
      () => {
        calls++
        return { ok: true, value: 'unexpected' }
      },
      () => 999_999,
    )
    const recovered = await gatedKeychainAttempt(
      { ...request, interactive: true },
      () => {
        calls++
        return { ok: true, value: 'mock' }
      },
      () => 1_000_000,
    )
    assert({
      given: 'denial, later polling, and deliberate recovery',
      should: 'make only the two authorized attempts',
      actual: [denied.ok, paused.ok, recovered.ok, calls],
      expected: [false, false, true, 2],
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Keychain gate reserves a cooldown before entering a call that can hang', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sky-keychain-crash-'))
  const request: KeychainRequest = {
    operation: 'set',
    service: 'sky-test',
    account: 'main',
    value: 'mock',
    stateDir: dir,
  }
  try {
    await gatedKeychainAttempt(
      request,
      () => {
        throw new Error('simulated worker death')
      },
      () => 0,
    ).catch(() => {})
    let calls = 0
    const waiting = await gatedKeychainAttempt(
      request,
      () => {
        calls++
        return { ok: true, value: null }
      },
      () => 10_000,
    )
    const retried = await gatedKeychainAttempt(
      request,
      () => {
        calls++
        return { ok: true, value: null }
      },
      () => 90_000,
    )
    assert({
      given: 'a worker disappears before saving its outcome',
      should: 'delay another attempt and later recover',
      actual: [waiting.ok, retried.ok, calls],
      expected: [false, true, 1],
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Keychain backoff grows and stays capped', () => {
  assert({
    given: 'repeated transient failures',
    should: 'grow the cooldown to five minutes',
    actual: [1, 2, 3, 4, 5, 100].map((n) => keychainBackoff(n, 1)),
    expected: [30_000, 60_000, 120_000, 240_000, 300_000, 300_000],
  })
})
